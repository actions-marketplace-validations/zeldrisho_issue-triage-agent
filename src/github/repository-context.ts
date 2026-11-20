import { z } from "zod";
import type { ActionContext } from "../types.js";
import type { RepositoryTools } from "../llm/repository-tools.js";

const MAX_CALLS = 40;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 240_000;
const MAX_CHARS_PER_READ = 12_000;
const PAGE_SIZE = 100;

const entrySchema = z.object({
  path: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/i),
  mode: z.enum(["100644", "100755"]),
  type: z.literal("blob"),
  size: z.number().nonnegative(),
});

const treeSchema = z.object({ tree: z.array(z.unknown()), truncated: z.boolean().optional() });

const argsSchema = z.object({
  query: z.string().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  path: z.string().max(4096).optional(),
});

/** Expose read-only files at one commit. No paths are passed to a shell or URL fetcher. */
export function repositoryTools(actx: ActionContext): RepositoryTools {
  const request = { timeout: 5000, retries: 0, signal: actx.signal };
  const ref = actx.repositoryRef ?? actx.payload.repository.default_branch;
  let calls = 0;
  let bytesRead = 0;
  let subtreeRequests = 0;

  let treePromise:
    | Promise<{
        entries: z.infer<typeof entrySchema>[];
        truncated: boolean;
        commit: string;
        root: string;
      }>
    | undefined;

  async function tree() {
    if (!treePromise) {
      treePromise = (async () => {
        const commitResult = await actx.octokit.rest.repos.getCommit({
          owner: actx.owner,
          repo: actx.repo,
          ref,
          request,
        });

        const commit = z
          .object({
            sha: z.string().regex(/^[a-f0-9]{40}$/i),
            commit: z.object({ tree: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) }) }),
          })
          .parse(commitResult.data);

        const result = await actx.octokit.rest.git.getTree({
          owner: actx.owner,
          repo: actx.repo,
          tree_sha: commit.commit.tree.sha,
          recursive: "true",
          request,
        });

        const parsed = treeSchema.parse(result.data);

        const entries = parsed.tree.flatMap((item) => {
          const entry = entrySchema.safeParse(item);

          return entry.success ? [entry.data] : [];
        });

        return {
          entries,
          truncated: parsed.truncated ?? false,
          commit: commit.sha,
          root: commit.commit.tree.sha,
        };
      })();
    }

    return treePromise;
  }

  async function directory(root: string, path: string) {
    const segments = path ? path.split("/") : [];

    if (
      segments.length > 12 ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    )
      throw new Error("Invalid directory");
    let sha = root;

    for (const segment of segments) {
      if (++subtreeRequests > 40) throw new Error("Subtree request limit reached");

      const response = await actx.octokit.rest.git.getTree({
        owner: actx.owner,
        repo: actx.repo,
        tree_sha: sha,
        request,
      });

      const parsed = treeSchema.parse(response.data);

      const itemSchema = z.object({
        path: z.string(),
        type: z.literal("tree"),
        sha: z.string().regex(/^[a-f0-9]{40}$/i),
      });

      const entries = parsed.tree.flatMap((item) => {
        const entry = itemSchema.safeParse(item);

        return entry.success ? [entry.data] : [];
      });

      const next = entries.find((entry) => entry.path === segment);

      if (!next || parsed.truncated) throw new Error("Directory unavailable");
      sha = next.sha;
    }

    if (++subtreeRequests > 40) throw new Error("Subtree request limit reached");

    const response = await actx.octokit.rest.git.getTree({
      owner: actx.owner,
      repo: actx.repo,
      tree_sha: sha,
      request,
    });

    return treeSchema.parse(response.data);
  }

  return {
    async run(name, input) {
      calls++;
      actx.logger.debug(`Repository tool call: ${name}`);

      if (calls > MAX_CALLS) return "Repository tool limit reached: maximum calls exceeded.";
      const args = argsSchema.safeParse(input);

      if (!args.success || !["list", "read", "search"].includes(name))
        return "Invalid repository tool request.";

      try {
        const snapshot = await tree();

        if (name === "list") {
          if (args.data.path !== undefined) {
            const result = await directory(snapshot.root, args.data.path);

            const schema = z.object({
              path: z.string(),
              type: z.enum(["tree", "blob"]),
              mode: z.string(),
            });

            const paths = result.tree.flatMap((item) => {
              const entry = schema.safeParse(item);

              if (
                !entry.success ||
                (entry.data.type === "blob" && !["100644", "100755"].includes(entry.data.mode))
              )
                return [];

              return [
                `${args.data.path ? `${args.data.path}/` : ""}${entry.data.path}${entry.data.type === "tree" ? "/" : ""}`,
              ];
            });

            const offset = args.data.offset ?? 0;

            const matches = paths.filter((path) =>
              path.toLowerCase().includes((args.data.query ?? "").toLowerCase()),
            );

            return JSON.stringify({
              ref,
              commit: snapshot.commit,
              paths: matches.slice(offset, offset + PAGE_SIZE),
              nextOffset: offset + PAGE_SIZE < matches.length ? offset + PAGE_SIZE : null,
              truncated: result.truncated ?? false,
            });
          }

          const query = (args.data.query ?? "").toLowerCase();
          const offset = args.data.offset ?? 0;

          const matches = snapshot.entries.filter((entry) =>
            entry.path.toLowerCase().includes(query),
          );

          return JSON.stringify({
            ref,
            commit: snapshot.commit,
            paths: matches.slice(offset, offset + PAGE_SIZE).map((entry) => entry.path),
            nextOffset: offset + PAGE_SIZE < matches.length ? offset + PAGE_SIZE : null,
            truncated: snapshot.truncated,
            notice: "A truncated tree is incomplete.",
          });
        }

        if (name === "search") {
          const query = args.data.query ?? "";

          if (!/^[a-zA-Z0-9_ ]{1,100}$/.test(query.trim()))
            return "Search supports plain words only.";

          const result = await actx.octokit.rest.search.code({
            q: `${query.trim()} repo:${actx.owner}/${actx.repo}`,
            per_page: 30,
            request,
          });

          const parsed = z
            .object({
              items: z.array(z.object({ path: z.string() })),
              incomplete_results: z.boolean().optional(),
            })
            .parse(result.data);

          const paths = parsed.items
            .map((item) => item.path)
            .filter(
              (path) => snapshot.truncated || snapshot.entries.some((entry) => entry.path === path),
            );

          return JSON.stringify({
            ref,
            paths,
            notice:
              "Search uses GitHub's index, which may be incomplete or stale. Read files to verify at the selected commit.",
            incomplete: parsed.incomplete_results ?? false,
          });
        }

        let entry = snapshot.entries.find((item) => item.path === args.data.path);

        if (!entry && snapshot.truncated && args.data.path) {
          const parts = args.data.path.split("/");
          const filename = parts.pop();
          const result = await directory(snapshot.root, parts.join("/"));

          if (result.truncated) return "Directory listing is incomplete.";

          for (const item of result.tree) {
            const parsed = entrySchema.safeParse(item);

            if (parsed.success && parsed.data.path === filename)
              entry = { ...parsed.data, path: args.data.path };
          }
        }

        if (!entry)
          return "Repository file not found in the available tree; the tree may be incomplete.";

        if (entry.size > MAX_FILE_BYTES)
          return "Repository file limit reached: file exceeds the per-file size limit.";

        if (bytesRead >= MAX_TOTAL_BYTES)
          return "Repository file limit reached: total read limit exceeded.";

        const result = await actx.octokit.rest.git.getBlob({
          owner: actx.owner,
          repo: actx.repo,
          file_sha: entry.sha,
          request,
        });

        const blob = z
          .object({
            encoding: z.literal("base64"),
            content: z.string().max(1_400_000),
            size: z.number().nonnegative().max(MAX_FILE_BYTES),
          })
          .parse(result.data);

        const bytes = Buffer.from(blob.content, "base64");

        if (bytes.length !== entry.size || bytes.length !== blob.size || bytes.includes(0))
          return "File unavailable, invalid, or binary.";
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const offset = args.data.offset ?? 0;
        const content = text.slice(offset, offset + MAX_CHARS_PER_READ);
        const size = Buffer.byteLength(content);

        if (bytesRead + size > MAX_TOTAL_BYTES)
          return "Repository file limit reached: total read limit exceeded.";
        bytesRead += size;

        return JSON.stringify({
          ref,
          commit: snapshot.commit,
          path: entry.path,
          content,
          nextOffset: offset + content.length < text.length ? offset + content.length : null,
        });
      } catch (error) {
        const status = z.object({ status: z.number() }).safeParse(error).data?.status;

        if (status === 404) {
          actx.logger.warn(`Configured repository ref could not be resolved: ${ref}`);

          return "Repository data not found at the selected ref.";
        }

        if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504)
          return "Repository data unavailable: request timed out or was rate limited.";

        if (
          error instanceof TypeError ||
          (error instanceof Error && /utf-?8|binary|invalid/i.test(error.message))
        )
          return "Repository file unavailable: binary or non-UTF-8 content.";

        return "Repository data unavailable: repository request failed.";
      }
    },
  };
}

import { describe, expect, it, vi } from "vite-plus/test";
import { repositoryTools } from "../src/github/repository-context.js";
import type { ActionContext } from "../src/types.js";

const sha = "a".repeat(40);

function context(content = "Hello repo") {
  const getCommit = vi.fn().mockResolvedValue({ data: { sha, commit: { tree: { sha } } } });

  const getTree = vi.fn().mockResolvedValue({
    data: {
      tree: [
        { path: "src/app.ts", sha, mode: "100644", type: "blob", size: Buffer.byteLength(content) },
        { path: "link", sha, mode: "120000", type: "blob", size: 1 },
      ],
      truncated: false,
    },
  });

  const getBlob = vi.fn().mockResolvedValue({
    data: {
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
      size: Buffer.byteLength(content),
    },
  });

  const searchCode = vi
    .fn()
    .mockResolvedValue({ data: { items: [{ path: "src/app.ts" }, { path: "not-in-snapshot" }] } });

  const logger: ActionContext["logger"] = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };

  const actx: ActionContext = {
    owner: "owner",
    repo: "repo",
    eventName: "issues",
    logger,
    payload: {
      action: "opened",
      issue: { number: 1, title: "title", body: "body", html_url: "url", created_at: "now" },
      repository: { name: "repo", owner: { login: "owner" }, default_branch: "main" },
    },
    octokit: {
      rest: { repos: { getCommit }, git: { getTree, getBlob }, search: { code: searchCode } },
    },
  };

  return { actx, getCommit, getTree, getBlob };
}

describe("repository tools", () => {
  it("lists and reads files at a fixed commit", async () => {
    const { actx, getTree, getBlob } = context();
    const tools = repositoryTools(actx);

    expect(await tools.run("list", { query: "app" })).toContain("src/app.ts");
    const search = await tools.run("search", { query: "hello" });

    expect(search).toContain("src/app.ts");
    expect(search).not.toContain("not-in-snapshot");
    expect(await tools.run("search", { query: "repo:other/private" })).toContain("plain words");
    expect(await tools.run("read", { path: "src/app.ts" })).toContain("Hello repo");
    expect(getTree).toHaveBeenCalledWith(expect.objectContaining({ tree_sha: sha }));
    expect(getBlob).toHaveBeenCalledWith(expect.objectContaining({ file_sha: sha }));
    expect(await tools.run("read", { path: "link" })).toContain("not found");
    expect(await tools.run("read", { path: "../../secret" })).toContain("not found");
  });

  it("rejects oversized and binary files", async () => {
    expect(
      await repositoryTools(context("x".repeat(1000001)).actx).run("read", {
        path: "src/app.ts",
      }),
    ).toContain("limit");
    expect(
      await repositoryTools(context("a\0b").actx).run("read", { path: "src/app.ts" }),
    ).toContain("binary");
  });

  it("walks subtrees when the recursive tree is truncated", async () => {
    const { actx, getTree } = context();

    getTree
      .mockResolvedValueOnce({ data: { tree: [], truncated: true } })
      .mockResolvedValueOnce({
        data: { tree: [{ path: "src", type: "tree", sha, mode: "040000" }], truncated: false },
      })
      .mockResolvedValueOnce({
        data: {
          tree: [{ path: "app.ts", sha, mode: "100644", type: "blob", size: 10 }],
          truncated: false,
        },
      });
    const tools = repositoryTools(actx);

    expect(await tools.run("read", { path: "src/app.ts" })).toContain("Hello repo");
  });

  it("retains indexed search hits for truncated trees and verifies reads at the snapshot", async () => {
    const { actx, getTree } = context();
    getTree
      .mockResolvedValueOnce({ data: { tree: [], truncated: true } })
      .mockResolvedValueOnce({
        data: { tree: [{ path: "src", type: "tree", sha }], truncated: false },
      })
      .mockResolvedValueOnce({
        data: {
          tree: [{ path: "app.ts", sha, mode: "100644", type: "blob", size: 10 }],
          truncated: false,
        },
      });
    const tools = repositoryTools(actx);
    expect(JSON.parse(await tools.run("search", { query: "hello" })).paths).toContain("src/app.ts");
    expect(await tools.run("read", { path: "src/app.ts" })).toContain("Hello repo");
  });

  it("reads files in pages", async () => {
    const tools = repositoryTools(context("x".repeat(12000) + "tail").actx);
    const first = JSON.parse(await tools.run("read", { path: "src/app.ts" }));

    const second = JSON.parse(
      await tools.run("read", { path: "src/app.ts", offset: first.nextOffset }),
    );

    expect(first.nextOffset).toBe(12000);
    expect(second.content).toBe("tail");
    expect(second.nextOffset).toBeNull();
  });

  it("enforces the total tool call limit", async () => {
    const tools = repositoryTools(context().actx);

    for (let i = 0; i < 40; i++) await tools.run("list", {});
    expect(await tools.run("list", {})).toContain("limit");
  });

  it("handles API errors and rejects unknown tools", async () => {
    const { actx, getCommit } = context();
    getCommit.mockRejectedValue(new Error("forbidden"));
    const tools = repositoryTools(actx);

    expect(await tools.run("read", { path: "src/app.ts" })).toContain("unavailable");
    expect(await tools.run("shell", {})).toContain("Invalid");
  });
});

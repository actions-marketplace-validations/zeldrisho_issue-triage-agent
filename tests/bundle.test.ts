import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runBundle(provider: "anthropic" | "openai", eventName: "issues" | "issue_comment") {
  const dir = mkdtempSync(join(tmpdir(), "action-bundle-"));
  tempDirs.push(dir);
  cpSync(resolve("dist"), join(dir, "dist"), { recursive: true });

  const issue = {
    number: 1,
    title: "Broken login",
    body: "Login fails",
    html_url: "https://example.com/issues/1",
    created_at: "2026-01-01T00:00:00Z",
    user: { login: "reporter" },
    labels: [],
  };

  const payload = {
    action: eventName === "issues" ? "opened" : "created",
    issue,
    repository: { name: "repo", owner: { login: "owner" }, default_branch: "main" },
    comment: {
      id: 1,
      body: "Any update?",
      html_url: "https://example.com/comment/1",
      created_at: "2026-01-01T00:00:00Z",
      user: { login: "reporter" },
    },
  };

  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  const requests: string[] = [];
  let llmRequests = 0;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "";
    requests.push(`${req.method} ${path}`);
    let body = "";

    if (req.method === "GET" && path.startsWith("/repos/owner/repo/issues/1/comments")) {
      body = JSON.stringify([]);
    } else if (path.includes("/contents")) {
      const config = { llm: { provider }, features: { duplicateSearch: true } };
      body = JSON.stringify({ content: Buffer.from(JSON.stringify(config)).toString("base64") });
    } else if (path.startsWith("/search/issues")) {
      body = JSON.stringify({
        items: [{ number: 2, title: "Login broken", html_url: "https://example.com/2" }],
      });
    } else if (path.endsWith("/messages") || path.endsWith("/chat/completions")) {
      llmRequests += 1;
      let text = "Thank you for reporting this.";

      if (eventName === "issues" && llmRequests === 1) {
        text = JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Broken",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        });
      } else if (eventName === "issues" && llmRequests === 2) {
        text = JSON.stringify({ duplicates: [2], reasoning: "Same issue" });
      }

      body = JSON.stringify({
        id: "test",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }],
      });
    } else {
      body = JSON.stringify(path.endsWith("/labels") ? [] : { id: 1 });
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = z.object({ port: z.number() }).parse(server.address());
  const url = `http://127.0.0.1:${address.port}`;

  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    GITHUB_API_URL: url,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_TOKEN: "github-test-token",
    "INPUT_LLM-PROVIDER": provider,
    "INPUT_LLM-BASE-URL": url,
    "INPUT_ANTHROPIC-API-KEY": "anthropic-test-key",
    "INPUT_OPENAI-API-KEY": "openai-test-key",
  };

  try {
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, [join(dir, "dist/main.mjs")], { cwd: dir, env });
      let output = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Bundle subprocess timed out"));
      }, 15_000);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ code, output });
      });
    });

    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain("::error::");

    for (const secret of ["github-test-token", "anthropic-test-key", "openai-test-key"]) {
      expect(result.output).toContain(`::add-mask::${secret}`);
    }

    expect(requests).toContain("POST /repos/owner/repo/issues/1/comments");

    if (eventName === "issues") {
      expect(result.output).toContain("Duplicate detection completed");
      expect(result.output).toContain("reply-posted::true");
      expect(requests).toContain("POST /repos/owner/repo/issues/1/labels");
      expect(llmRequests).toBe(3);
    } else {
      expect(result.output).toContain("Comment reply posted");
      expect(llmRequests).toBe(1);
    }
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}

describe("isolated Action bundle", () => {
  it("includes licenses for bundled runtime dependencies", () => {
    const licenses = readFileSync(resolve("dist/licenses.txt"), "utf8");

    for (const name of ["@actions/core@", "@anthropic-ai/sdk@", "openai@", "js-yaml@", "zod@"]) {
      expect(licenses).toContain(name);
    }
  });

  for (const provider of ["anthropic", "openai"] as const) {
    it(`handles issue triage with ${provider}`, async () => {
      await runBundle(provider, "issues");
    }, 20_000);
    it(`handles follow-up comments with ${provider}`, async () => {
      await runBundle(provider, "issue_comment");
    }, 20_000);
  }
});

import { describe, expect, it, vi } from "vite-plus/test";
import { loadVoiceSample } from "../src/voice.js";
import type { ActionContext } from "../src/types.js";

type VoiceResponse = { content?: string; encoding?: string; type?: string };

function context(response: VoiceResponse): ActionContext {
  return {
    owner: "owner",
    repo: "repo",
    eventName: "issues",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    octokit: { rest: { repos: { getContent: vi.fn().mockResolvedValue({ data: response }) } } },
    payload: {
      action: "opened",
      issue: { number: 1, title: "title", body: "body", html_url: "url", created_at: "now" },
      repository: { name: "repo", owner: { login: "owner" }, default_branch: "main" },
    },
  };
}

describe("loadVoiceSample", () => {
  it("loads the repository voice sample", async () => {
    const result = await loadVoiceSample(
      context({ content: Buffer.from("Direct reply.").toString("base64"), encoding: "base64" }),
    );

    expect(result).toBe("Direct reply.");
  });

  it("returns absent or oversized samples safely", async () => {
    await expect(loadVoiceSample(context({ type: "file" }))).resolves.toBeUndefined();
    await expect(
      loadVoiceSample(
        context({ content: Buffer.from("x".repeat(7000)).toString("base64"), encoding: "base64" }),
      ),
    ).resolves.toHaveLength(6000);
  });
});

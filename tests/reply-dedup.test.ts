import { describe, expect, it, vi } from "vite-plus/test";
import { markReply, replyAlreadyPosted, replyMarker } from "../src/github/reply-dedup.js";
import type { ActionContext } from "../src/types.js";

function context() {
  const listComments = vi.fn().mockResolvedValue({ data: [] });

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
    logger,
    eventName: "issue_comment",
    payload: {
      action: "created",
      issue: { number: 1, title: "title", body: "", html_url: "url", created_at: "now" },
      comment: { id: 12, body: "hi", html_url: "url", created_at: "now" },
      repository: { name: "repo", owner: { login: "owner" }, default_branch: "main" },
    },
    octokit: { rest: { issues: { listComments } } },
  };

  return { actx, listComments };
}

describe("reply deduplication", () => {
  it("only accepts a matching marker from the configured account", async () => {
    const { actx, listComments } = context();
    const marker = replyMarker(actx);

    listComments.mockResolvedValueOnce({ data: [{ body: marker, user: { login: "attacker" } }] });
    expect(await replyAlreadyPosted(actx, marker)).toBe(false);
    listComments.mockResolvedValueOnce({
      data: [{ body: marker, user: { login: "github-actions[bot]" } }],
    });
    expect(await replyAlreadyPosted(actx, marker)).toBe(true);
  });

  it("removes model-provided markers before adding its own", () => {
    expect(
      markReply(
        "hello <!-- issue-triage-agent:comment:99 -->",
        "<!-- issue-triage-agent:comment:12 -->",
      ),
    ).toBe("hello\n\n<!-- issue-triage-agent:comment:12 -->");
  });

  it("propagates lookup errors rather than posting blindly", async () => {
    const { actx, listComments } = context();
    listComments.mockRejectedValue(new Error("unavailable"));
    await expect(replyAlreadyPosted(actx, replyMarker(actx))).rejects.toThrow("unavailable");
  });
});

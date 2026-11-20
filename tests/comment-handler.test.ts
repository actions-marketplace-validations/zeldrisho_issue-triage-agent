import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { handleComment } from "../src/comment-handler.js";
import type { ActionContext } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockResolvedValue({
      text: "Thanks for the additional details! This helps us investigate.\n\n-- Issue Triage Agent :robot:",
      usage: { inputTokens: 100, outputTokens: 30 },
    }),
  })),
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    enabled: true,
    features: { classify: true, reply: true, duplicateSearch: true, commentReply: true },
    labelMapping: {
      bug: ["bug"],
      feature: ["enhancement"],
      question: ["question"],
      docs: ["documentation"],
      duplicate: ["duplicate"],
      invalid: ["invalid"],
      security: ["security"],
    },
    security: { maxIssueLength: 10000 },
    exclude: { labels: ["wontfix", "skip-ai"], users: ["dependabot[bot]"] },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  }),
}));

const basePayload = {
  action: "created",
  issue: {
    number: 5,
    title: "App crashes on save",
    body: "Steps to reproduce:\n1. Open app\n2. Click save\n3. Crash",
    html_url: "https://github.com/owner/repo/issues/5",
    user: { login: "issue-author" },
    labels: [{ name: "bug", id: 1 }],
    created_at: "2026-05-18T00:00:00Z",
    state: "open" as const,
  },
  comment: {
    id: 100,
    body: "I'm using Chrome 120 on macOS.",
    html_url: "https://github.com/owner/repo/issues/5#issuecomment-100",
    user: { login: "commenter" },
    created_at: "2026-05-19T00:00:00Z",
  },
  repository: {
    name: "repo",
    owner: { login: "owner" },
    default_branch: "main",
  },
  sender: { login: "commenter", type: "User" },
};

function createMockActionContext(overrides: Partial<ActionContext> = {}): ActionContext {
  const mockLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLog),
  };

  const mockOctokit = {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({}),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  };

  return {
    owner: "owner",
    repo: "repo",
    octokit: mockOctokit,
    logger: mockLog,
    eventName: "issue_comment",
    payload: { ...basePayload },
    ...overrides,
  };
}

describe("handleComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it.each([true, false])(
    "honors repository context setting for comment replies: %s",
    async (enabled) => {
      const { loadConfig } = await import("../src/config/loader.js");
      const { createProvider } = await import("../src/llm/factory.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        ...DEFAULT_CONFIG,
        features: { ...DEFAULT_CONFIG.features, repositoryContext: enabled },
      });

      const complete = vi
        .fn()
        .mockResolvedValue({ text: "reply", usage: { inputTokens: 0, outputTokens: 0 } });

      const completeWithRepository = vi
        .fn()
        .mockResolvedValue({ text: "reply", usage: { inputTokens: 0, outputTokens: 0 } });

      vi.mocked(createProvider).mockReturnValueOnce({ complete, completeWithRepository });
      await handleComment(createMockActionContext());
      expect(completeWithRepository).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(complete).toHaveBeenCalledTimes(enabled ? 0 : 1);
    },
  );

  it("propagates configuration errors", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("invalid config"));
    await expect(handleComment(createMockActionContext())).rejects.toThrow("invalid config");
  });

  it("skips bot comments", async () => {
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        sender: { login: "bot-account", type: "Bot" },
      },
    });

    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it.each([
    { state: "closed" as const, state_reason: "completed" as const, locked: false },
    { state: "closed" as const, state_reason: "not_planned" as const, locked: false },
    { state: "closed" as const, state_reason: "duplicate" as const, locked: false },
    { state: "open" as const, state_reason: null, locked: true },
  ])("skips replies for closed or locked issues by default", async (issueState) => {
    const actx = createMockActionContext({
      payload: { ...basePayload, issue: { ...basePayload.issue, ...issueState } },
    });

    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("allows replies for closed issues when configured", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, commentReplyOnClosed: true },
    });

    const actx = createMockActionContext({
      payload: { ...basePayload, issue: { ...basePayload.issue, state: "closed", locked: false } },
    });

    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it("skips comments on pull requests", async () => {
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        issue: {
          ...basePayload.issue,
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" },
        },
      },
    });

    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips when commentReply is disabled", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, commentReply: false },
    });

    const actx = createMockActionContext();
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips excluded users", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      exclude: { ...DEFAULT_CONFIG.exclude, users: ["commenter"] },
    });

    const actx = createMockActionContext();
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips comments on issues with excluded labels", async () => {
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        issue: { ...basePayload.issue, labels: [{ name: "skip-ai", id: 2 }] },
      },
    });

    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("does not post a duplicate reply for a comment rerun", async () => {
    const actx = createMockActionContext();

    actx.octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        { user: { login: "github-actions[bot]" }, body: "<!-- issue-triage-agent:comment:100 -->" },
      ],
    });
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("prioritizes bounded follow-up images over original issue images", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce(DEFAULT_CONFIG);

    const urls = Array.from(
      { length: 4 },
      (_, index) => `https://user-images.githubusercontent.com/${index}/old.png`,
    );

    const current = "https://user-images.githubusercontent.com/9/current.png";
    const ignored = "https://user-images.githubusercontent.com/10/ignored.png";

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    try {
      const actx = createMockActionContext({
        payload: {
          ...basePayload,
          issue: { ...basePayload.issue, body: urls.join(" ") },
          comment: { ...basePayload.comment, body: `${current} ${"x".repeat(5000)} ${ignored}` },
        },
      });

      await handleComment(actx);
      expect(fetchMock.mock.calls[0][0]).toBe(current);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain(ignored);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts a reply for a valid comment", async () => {
    const actx = createMockActionContext();

    await handleComment(actx);

    expect(actx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const call: { body: string } = actx.octokit.rest.issues.createComment.mock.calls[0][0];
    expect(call.body).toContain("Issue Triage Agent");
  });

  it.each(["NO_REPLY", "`NO_REPLY`", "```\nNO_REPLY\n```", "NO_REPLY.", "`NO_REPLY`"])(
    "skips a no-reply response: %s",
    async (text) => {
      const { createProvider } = await import("../src/llm/factory.js");
      vi.mocked(createProvider).mockReturnValueOnce({
        complete: vi.fn().mockResolvedValue({ text, usage: { inputTokens: 0, outputTokens: 0 } }),
      });
      const actx = createMockActionContext();
      await handleComment(actx);
      expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    },
  );

  it("does not suppress ordinary text containing NO_REPLY", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: "Please use NO_REPLY here.",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    const actx = createMockActionContext();
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it("provides earlier comments but not later comments to the model", async () => {
    const { createProvider } = await import("../src/llm/factory.js");

    const complete = vi
      .fn()
      .mockResolvedValue({ text: "reply", usage: { inputTokens: 0, outputTokens: 0 } });

    vi.mocked(createProvider).mockReturnValueOnce({ complete });
    const actx = createMockActionContext();
    actx.octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        { id: 99, user: { login: "alice" }, body: "earlier context" },
        { id: 100, user: { login: "commenter" }, body: "current" },
        { id: 101, user: { login: "bob" }, body: "later context" },
      ],
    });
    await handleComment(actx);
    const prompt = JSON.stringify(complete.mock.calls[0][2]);
    expect(prompt).toContain("earlier context");
    expect(prompt).not.toContain("later context");
  });

  it("truncates long LLM responses", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: "x".repeat(5000) + "\n\n-- Issue Triage Agent :robot:",
        usage: { inputTokens: 100, outputTokens: 100 },
      }),
    });

    const actx = createMockActionContext();
    await handleComment(actx);

    const call: { body: string } = actx.octokit.rest.issues.createComment.mock.calls[0][0];
    expect(call.body.length).toBeLessThanOrEqual(4100);
    expect(call.body).toContain("truncated");
  });
});

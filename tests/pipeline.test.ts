import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { runPipeline } from "../src/pipeline.js";
import type { ActionContext } from "../src/types.js";
import { createProvider } from "../src/llm/factory.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

// Mock LLM factory to avoid real API calls
vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockImplementation((_model, _sysPrompt, messages) => {
      const userMsg = messages[0]?.content ?? "";

      if (userMsg.includes("=== ISSUE DATA BEGIN")) {
        return Promise.resolve({
          text: JSON.stringify({
            category: "bug",
            priority: "high",
            confidence: 0.9,
            summary: "App crashes on save",
            suggestedLabels: ["bug"],
            reasoning: "Clear crash report",
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        });
      }

      if (userMsg.includes("Candidate issues")) {
        return Promise.resolve({
          text: JSON.stringify({
            duplicates: [],
            reasoning: "No duplicates found among candidates.",
          }),
          usage: { inputTokens: 80, outputTokens: 20 },
        });
      }

      // Reply call
      return Promise.resolve({
        text: "Thanks for reporting this crash! We'll look into it.\n\n-- Issue Triage Agent :robot:",
        usage: { inputTokens: 100, outputTokens: 30 },
      });
    }),
  })),
}));

// Mock GitHub search API
vi.mock("../src/github/search.js", () => ({
  searchSimilarIssues: vi.fn().mockResolvedValue([]),
  searchRelatedPullRequests: vi.fn().mockResolvedValue([]),
}));

// Mock config loader — inline default config to avoid hoisting issues
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
    labeling: { minConfidence: 0, skipAssigned: false, skipLabeled: false },
    security: { maxIssueLength: 10000 },
    exclude: { labels: ["wontfix", "skip-ai"], users: ["dependabot[bot]"] },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  }),
}));

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
        addLabels: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
      },
      search: {
        issuesAndPullRequests: vi.fn().mockResolvedValue({
          data: { items: [] },
        }),
      },
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      },
    },
  };

  return {
    owner: "owner",
    repo: "repo",
    octokit: mockOctokit,
    logger: mockLog,
    eventName: "issues",
    payload: {
      action: "opened",
      issue: {
        number: 1,
        title: "App crashes when clicking save",
        body: "Steps to reproduce:\n1. Open app\n2. Click save\n3. Crash",
        html_url: "https://github.com/owner/repo/issues/1",
        user: { login: "testuser", type: "User" },
        labels: [],
        created_at: "2026-05-18T00:00:00Z",
      },
      sender: { login: "testuser", type: "User" },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
    },
    ...overrides,
  };
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it.each([true, false])(
    "honors repository context setting for issue replies: %s",
    async (enabled) => {
      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        ...DEFAULT_CONFIG,
        features: {
          ...DEFAULT_CONFIG.features,
          classify: false,
          duplicateSearch: false,
          repositoryContext: enabled,
        },
      });

      const complete = vi
        .fn()
        .mockResolvedValue({ text: "reply", usage: { inputTokens: 0, outputTokens: 0 } });

      const completeWithRepository = vi
        .fn()
        .mockResolvedValue({ text: "reply", usage: { inputTokens: 0, outputTokens: 0 } });

      vi.mocked(createProvider).mockReturnValueOnce({ complete, completeWithRepository });
      await runPipeline(createMockActionContext());
      expect(completeWithRepository).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(complete).toHaveBeenCalledTimes(enabled ? 0 : 1);
    },
  );

  it("propagates configuration errors", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("invalid config"));
    await expect(runPipeline(createMockActionContext())).rejects.toThrow("invalid config");
  });

  it("skips when bot is disabled", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: false });

    const actx = createMockActionContext();
    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
    expect(result.labelsApplied).toEqual([]);
    expect(result.replyPosted).toBe(false);
  });

  it("skips excluded users", async () => {
    const actx = createMockActionContext({
      payload: {
        ...createMockActionContext().payload,
        issue: {
          ...createMockActionContext().payload.issue,
          user: { login: "dependabot[bot]", type: "Bot" },
        },
      },
    });

    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
  });

  it("skips issues with excluded labels", async () => {
    const actx = createMockActionContext({
      payload: {
        ...createMockActionContext().payload,
        issue: {
          ...createMockActionContext().payload.issue,
          labels: [{ name: "skip-ai", id: 1 }],
        },
      },
    });

    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
  });

  it("does not mutate issues when no LLM API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(createProvider).mockReturnValueOnce(null);
    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
    expect(result.replyPosted).toBe(false);
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("does not post a duplicate reply for an issue rerun", async () => {
    const actx = createMockActionContext();

    actx.octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        { user: { login: "github-actions[bot]" }, body: "<!-- issue-triage-agent:issue:1 -->" },
      ],
    });
    const result = await runPipeline(actx);

    expect(result.replyPosted).toBe(false);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("stops before side effects when its deadline is already expired", async () => {
    const actx = createMockActionContext({ signal: AbortSignal.abort(new Error("deadline")) });

    await expect(runPipeline(actx)).rejects.toThrow("deadline");
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  it("does not download images beyond the configured issue length", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce(DEFAULT_CONFIG);
    const actx = createMockActionContext();
    actx.payload.issue.body =
      "x".repeat(10001) + " https://user-images.githubusercontent.com/9/hidden.png";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await runPipeline(actx);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not apply labels for malformed classification and still replies", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "not json", usage: { inputTokens: 0, outputTokens: 0 } })
      .mockResolvedValueOnce({
        text: "Thanks for reporting this.",
        usage: { inputTokens: 0, outputTokens: 0 },
      });

    vi.mocked(createProvider).mockReturnValueOnce({ complete });
    const actx = createMockActionContext();
    const result = await runPipeline(actx);

    expect(result.classification).toBeNull();
    expect(result.labelsApplied).toEqual([]);
    expect(result.errors.map((error) => error.step)).toContain("classify");
    expect(result.replyPosted).toBe(true);
    expect(complete.mock.calls[1][2][0].content).toContain("Classification: unavailable");
  });

  it("skips labels below the configured confidence without blocking replies", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, repositoryContext: false, media: false },
      labeling: { ...DEFAULT_CONFIG.labeling, minConfidence: 1 },
    });
    const actx = createMockActionContext();
    const result = await runPipeline(actx);
    expect(result.replyPosted).toBe(true);
    expect(result.labelingStatus).toBe("skipped-confidence");
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  it.each(["assigned", "labeled"])("skips labeling when the current issue is %s", async (state) => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, repositoryContext: false, media: false },
      labeling: { minConfidence: 0, skipAssigned: true, skipLabeled: true },
    });
    const actx = createMockActionContext();
    actx.octokit.rest.issues.get = vi.fn().mockResolvedValue({
      data: {
        assignees: state === "assigned" ? [{}] : [],
        labels: state === "labeled" ? [{}] : [],
      },
    });
    const result = await runPipeline(actx);
    expect(result.replyPosted).toBe(true);
    expect(result.labelingStatus).toBe(`skipped-${state}`);
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  it("reports complete label failure without blocking replies", async () => {
    const actx = createMockActionContext();
    actx.octokit.rest.issues.addLabels.mockRejectedValue(new Error("label unavailable"));
    const result = await runPipeline(actx);
    expect(result.labelingStatus).toBe("failed");
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ step: "label" })]),
    );
    expect(result.replyPosted).toBe(true);
  });

  it("reports partially applied labels as partial", async () => {
    const actx = createMockActionContext();
    actx.octokit.rest.issues.addLabels
      .mockRejectedValueOnce(new Error("bulk failed"))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("label unavailable"));
    const result = await runPipeline(actx);
    expect(result.labelingStatus).toBe("partial");
    expect(result.labelsApplied).toHaveLength(1);
    expect(result.errors.filter((error) => error.step === "label")).toEqual([]);
  });

  it("isolates a related pull request search failure from the reply", async () => {
    const { searchRelatedPullRequests } = await import("../src/github/search.js");
    vi.mocked(searchRelatedPullRequests).mockRejectedValueOnce(new Error("unavailable"));
    const result = await runPipeline(createMockActionContext());
    expect(result.replyPosted).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "duplicate",
          message: "Related pull request search failed",
        }),
      ]),
    );
  });

  it("loads config and runs full pipeline with defaults", async () => {
    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification).not.toBeNull();
    expect(result.classification?.category).toBe("bug");
    expect(result.labelsApplied.length).toBeGreaterThan(0);
    expect(result.replyPosted).toBe(true);
  });

  it("passes duplicates to the reply even without classification", async () => {
    const { searchSimilarIssues } = await import("../src/github/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      {
        number: 42,
        title: "Same crash",
        url: "https://github.com/owner/repo/issues/42",
        body: "specific evidence",
      },
    ]);

    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "invalid", usage: {} })
      .mockResolvedValueOnce({ text: '{"duplicates":[42]}', usage: {} })
      .mockResolvedValueOnce({ text: "See #42", usage: {} });

    vi.mocked(createProvider).mockReturnValueOnce({ complete });
    const result = await runPipeline(createMockActionContext());
    expect(result.classification).toBeNull();
    expect(complete.mock.calls[1][2][0].content).toContain("specific evidence");
    expect(complete.mock.calls[2][2][0].content).toContain("#42");
  });

  it("sets relatedIssues when duplicates are found", async () => {
    const { searchSimilarIssues } = await import("../src/github/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      { number: 42, title: "Same crash", url: "https://github.com/owner/repo/issues/42" },
    ]);

    const mockProvider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            category: "duplicate",
            priority: "medium",
            confidence: 0.85,
            summary: "Duplicate of #42",
            suggestedLabels: ["duplicate"],
            reasoning: "Same crash as #42",
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            duplicates: [42],
            reasoning: "Same crash report",
          }),
          usage: { inputTokens: 80, outputTokens: 20 },
        })
        .mockResolvedValueOnce({
          text: "This appears to be a duplicate of #42.\n\n-- Issue Triage Agent :robot:",
          usage: { inputTokens: 100, outputTokens: 30 },
        }),
    };

    vi.mocked(createProvider).mockReturnValueOnce(mockProvider);

    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification?.category).toBe("duplicate");
    expect(result.classification?.relatedIssues).toEqual([
      { number: 42, title: "Same crash", url: "https://github.com/owner/repo/issues/42" },
    ]);
    expect(result.replyPosted).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  inputs: Object.fromEntries([]) satisfies Record<string, string>,
  getInput: vi.fn((name: string) => mocks.inputs[name] ?? ""),
  setSecret: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  runPipeline: vi.fn(),
  handleComment: vi.fn(),
  context: {
    eventName: "issues",
    repo: { owner: "owner", repo: "repo" },
    payload: {
      action: "opened",
      issue: {
        number: 1,
        title: "Test",
        body: null,
        html_url: "https://example.com/1",
        user: null,
        created_at: "2026-01-01T00:00:00Z",
      },
      repository: { name: "repo", owner: { login: "owner" }, default_branch: "main" },
    },
  },
}));

vi.mock("@actions/core", () => ({
  getInput: mocks.getInput,
  setSecret: mocks.setSecret,
  setFailed: mocks.setFailed,
  setOutput: mocks.setOutput,
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@actions/github", () => ({ context: mocks.context, getOctokit: vi.fn(() => ({})) }));

vi.mock("../src/pipeline.js", () => ({ runPipeline: mocks.runPipeline }));

vi.mock("../src/comment-handler.js", () => ({ handleComment: mocks.handleComment }));

describe("action entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    mocks.inputs = {
      "github-token": "token",
      "anthropic-api-key": "secret",
      "llm-model": "custom-model",
    };
    mocks.runPipeline.mockResolvedValue({
      classification: null,
      labelsApplied: [],
      replyPosted: false,
      labelingStatus: "skipped-confidence",
      errors: [{ step: "duplicate", message: "Search failed" }],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("wires the model input, masks credentials and accepts a null issue user", async () => {
    await import("../src/main.js");
    await vi.waitFor(() => expect(mocks.setOutput).toHaveBeenCalled());
    expect(mocks.getInput).toHaveBeenCalledWith("llm-model");
    expect(process.env.LLM_MODEL).toBe("custom-model");
    expect(mocks.setSecret).toHaveBeenCalledWith("token");
    expect(mocks.setSecret).toHaveBeenCalledWith("secret");
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "triage-report",
      expect.stringContaining('"labelingStatus":"skipped-confidence"'),
    );
    expect(mocks.setOutput).toHaveBeenCalledWith(
      "triage-report",
      expect.stringContaining('"message":"Search failed"'),
    );
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ issue: expect.objectContaining({ user: null }) }),
      }),
    );
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it("ignores unsupported issue actions", async () => {
    mocks.context.payload.action = "edited";

    try {
      await import("../src/main.js");
      expect(mocks.runPipeline).not.toHaveBeenCalled();
      expect(mocks.setFailed).not.toHaveBeenCalled();
    } finally {
      mocks.context.payload.action = "opened";
    }
  });

  it("fails for an invalid event payload", async () => {
    mocks.context.payload.issue.number = NaN;

    try {
      await import("../src/main.js");
      expect(mocks.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Invalid event payload"),
      );
      expect(mocks.runPipeline).not.toHaveBeenCalled();
    } finally {
      mocks.context.payload.issue.number = 1;
    }
  });

  it("fails for an invalid provider", async () => {
    mocks.inputs["llm-provider"] = "invalid";
    await import("../src/main.js");
    expect(mocks.setFailed).toHaveBeenCalledWith("llm-provider must be anthropic or openai");
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });

  it("fails the Action when configuration loading fails", async () => {
    mocks.runPipeline.mockRejectedValueOnce(new Error("invalid config"));
    await import("../src/main.js");
    await vi.waitFor(() =>
      expect(mocks.setFailed).toHaveBeenCalledWith("Action failed: invalid config"),
    );
  });
});

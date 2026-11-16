import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { loadConfig } from "../src/config/loader.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

function octokitFor(content: string) {
  return {
    rest: {
      repos: {
        getContent: vi
          .fn()
          .mockResolvedValue({ data: { content: Buffer.from(content).toString("base64") } }),
      },
    },
  };
}

describe("loadConfig", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the resolved provider's default model and preserves explicit models", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");
    expect((await loadConfig("owner", "repo", octokitFor(""))).llm.model).toBe("gpt-4o-mini");
    const missing = octokitFor("");
    missing.rest.repos.getContent.mockRejectedValue({ status: 404 });
    expect((await loadConfig("owner", "repo", missing)).llm.model).toBe("gpt-4o-mini");
    expect(
      (await loadConfig("owner", "repo", octokitFor("llm:\n  provider: anthropic\n"))).llm.model,
    ).toBe(DEFAULT_CONFIG.llm.model);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(
      (await loadConfig("owner", "repo", octokitFor("llm:\n  provider: openai\n"))).llm.model,
    ).toBe("gpt-4o-mini");
    vi.stubEnv("LLM_PROVIDER", "openai");
    expect(
      (await loadConfig("owner", "repo", octokitFor("llm:\n  provider: anthropic\n"))).llm.model,
    ).toBe("gpt-4o-mini");
    expect(
      (await loadConfig("owner", "repo", octokitFor("llm:\n  model: custom\n"))).llm.model,
    ).toBe("custom");
  });
  it("prioritizes the model input over repository configuration, ignoring empty values", async () => {
    const yaml = "llm:\n  model: configured-model\n";
    vi.stubEnv("LLM_MODEL", "  settings-model  ");
    expect((await loadConfig("owner", "repo", octokitFor(yaml))).llm.model).toBe("settings-model");
    vi.stubEnv("LLM_MODEL", "   ");
    expect((await loadConfig("owner", "repo", octokitFor(yaml))).llm.model).toBe(
      "configured-model",
    );
    expect((await loadConfig("owner", "repo", octokitFor(""))).llm.model).toBe(
      DEFAULT_CONFIG.llm.model,
    );
  });

  it("uses the issue-triage-agent config path by default and accepts an override", async () => {
    const octokit = octokitFor("");
    await loadConfig("owner", "repo", octokit);
    expect(octokit.rest.repos.getContent).toHaveBeenLastCalledWith({
      owner: "owner",
      repo: "repo",
      path: ".github/issue-triage-agent.yml",
    });
    await loadConfig("owner", "repo", octokit, ".github/custom.yml");
    expect(octokit.rest.repos.getContent).toHaveBeenLastCalledWith({
      owner: "owner",
      repo: "repo",
      path: ".github/custom.yml",
    });
  });
  it("uses defaults for empty or comment-only YAML", async () => {
    for (const text of ["", "# no settings\n"]) {
      await expect(loadConfig("owner", "repo", octokitFor(text))).resolves.toEqual(DEFAULT_CONFIG);
    }
  });

  it("supports YAML merge keys", async () => {
    const yaml =
      "defaults: &defaults\n  classify: false\nfeatures:\n  <<: *defaults\n  reply: false\n";

    const config = await loadConfig("owner", "repo", octokitFor(yaml));
    expect(config.features.classify).toBe(false);
    expect(config.features.reply).toBe(false);
    expect(config.features.duplicateSearch).toBe(true);
  });

  it("resolves provider input before repository configuration and credential detection", async () => {
    vi.stubEnv("OPENAI_API_KEY", "key");

    try {
      const config = await loadConfig("owner", "repo", octokitFor("llm:\n  provider: anthropic\n"));
      expect(config.llm.provider).toBe("anthropic");
      expect((await loadConfig("owner", "repo", octokitFor(""))).llm.provider).toBe("openai");
      vi.stubEnv("LLM_PROVIDER", "openai");
      expect(
        (await loadConfig("owner", "repo", octokitFor("llm:\n  provider: anthropic\n"))).llm
          .provider,
      ).toBe("openai");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    "llm:\n  provider: invalid\n",
    "llm:\n  model: ''\n",
    "llm:\n  max_tokens: -1\n",
    "llm:\n  max_tokens: 8193\n",
    "features:\n  reply: nope\n",
    "security:\n  max_issue_length: 0\n",
    "exclude:\n  users: false\n",
    "label_mapping:\n  bug: broken\n",
  ])("rejects invalid configuration: %s", async (yaml) => {
    await expect(loadConfig("owner", "repo", octokitFor(yaml))).rejects.toThrow();
  });

  it("rejects multiple YAML documents", async () => {
    await expect(
      loadConfig("owner", "repo", octokitFor("enabled: true\n---\nenabled: false\n")),
    ).rejects.toThrow();
  });
});

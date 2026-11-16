import { describe, expect, it, vi } from "vite-plus/test";
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

  it("rejects multiple YAML documents", async () => {
    await expect(
      loadConfig("owner", "repo", octokitFor("enabled: true\n---\nenabled: false\n")),
    ).rejects.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProvider } from "../src/llm/factory.js";
import type { Logger } from "../src/types.js";

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible gateway", () => {
  it("propagates gateway errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "gateway-secret");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example.com/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "invalid model" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const provider = createProvider("openai", logger);
    await expect(
      provider!.complete("invalid", "system", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("invalid model");
  });

  it("sends the configured model and bearer token to the gateway", async () => {
    vi.stubEnv("OPENAI_API_KEY", "gateway-secret");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example.com/v1");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = createProvider("openai", logger);
    expect(provider).not.toBeNull();

    const result = await provider!.complete(
      "anthropic/example",
      "system",
      [{ role: "user", content: "hi" }],
      100,
    );

    expect(result).toEqual({ text: "hello", usage: { inputTokens: 3, outputTokens: 2 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gateway.example.com/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer gateway-secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "anthropic/example", max_tokens: 100 });
  });
});

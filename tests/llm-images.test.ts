import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AnthropicProvider } from "../src/llm/client.js";
import { OpenAIProvider } from "../src/llm/openai.js";
import type { Logger } from "../src/types.js";

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
};

afterEach(() => vi.unstubAllGlobals());

describe("image messages", () => {
  for (const provider of ["anthropic", "openai"] as const) {
    it(`rejects truncated responses from ${provider}`, async () => {
      const response =
        provider === "anthropic"
          ? {
              content: [{ type: "text", text: "partial" }],
              stop_reason: "max_tokens",
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : { choices: [{ finish_reason: "length", message: { content: "partial" } }] };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      const client =
        provider === "anthropic"
          ? new AnthropicProvider("key", logger)
          : new OpenAIProvider("key", logger);

      await expect(
        client.complete("model", "system", [{ role: "user", content: "hi" }]),
      ).rejects.toThrow();
    });

    it(`encodes images for ${provider}`, async () => {
      const response =
        provider === "anthropic"
          ? {
              content: [{ type: "text", text: "ok" }],
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : {
              choices: [{ message: { content: "ok" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        }),
      );

      vi.stubGlobal("fetch", fetchMock);

      const client =
        provider === "anthropic"
          ? new AnthropicProvider("key", logger)
          : new OpenAIProvider("key", logger);

      await client.complete("model", "system", [
        {
          role: "user",
          content: "describe",
          images: [{ mediaType: "image/png", data: "YWJj" }],
        },
      ]);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const content = body.messages.at(-1).content;
      expect(content[0]).toEqual({ type: "text", text: "describe" });
      expect(content[1]).toEqual(
        provider === "anthropic"
          ? { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } }
          : { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
      );
    });
  }
});

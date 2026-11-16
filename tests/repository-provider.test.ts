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

describe("repository tool provider loops", () => {
  for (const provider of ["anthropic", "openai"] as const) {
    it(`executes a tool and returns the final ${provider} reply`, async () => {
      const responses =
        provider === "anthropic"
          ? [
              {
                content: [
                  { type: "tool_use", id: "call1", name: "read", input: { path: "src/a.ts" } },
                ],
                stop_reason: "tool_use",
                usage: { input_tokens: 1, output_tokens: 1 },
              },
              {
                content: [{ type: "text", text: "The file says hello." }],
                stop_reason: "end_turn",
                usage: { input_tokens: 2, output_tokens: 2 },
              },
            ]
          : [
              {
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call1",
                          type: "function",
                          function: { name: "read", arguments: '{"path":"src/a.ts"}' },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              },
              {
                choices: [
                  {
                    finish_reason: "stop",
                    message: { role: "assistant", content: "The file says hello." },
                  },
                ],
                usage: { prompt_tokens: 2, completion_tokens: 2 },
              },
            ];

      const fetchMock = vi.fn();

      for (const response of responses)
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const client =
        provider === "anthropic"
          ? new AnthropicProvider("key", logger)
          : new OpenAIProvider("key", logger);

      const run = vi.fn().mockResolvedValue("untrusted file content");

      const reply = await client.completeWithRepository(
        "model",
        "system",
        { role: "user", content: "explain" },
        { run },
        100,
      );

      expect(reply.text).toBe("The file says hello.");
      expect(run).toHaveBeenCalledWith("read", { path: "src/a.ts" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(JSON.parse(fetchMock.mock.calls[1][1].body).messages)).toContain(
        "untrusted file content",
      );
    });
  }
});

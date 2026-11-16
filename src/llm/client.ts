import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";
import {
  repositoryArgsSchema,
  repositoryToolDefinitions,
  type RepositoryTools,
} from "./repository-tools.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private logger: Logger;
  private signal?: AbortSignal;

  constructor(apiKey: string, logger: Logger, baseURL?: string, signal?: AbortSignal) {
    this.signal = signal;

    const options: ConstructorParameters<typeof Anthropic>[0] = {
      apiKey,
      timeout: 60_000,
      maxRetries: 1,
    };

    if (baseURL) options.baseURL = baseURL;

    this.client = new Anthropic(options);
    this.logger = logger.child({ module: "llm" });
  }

  async completeWithRepository(
    model: string,
    system: string,
    message: LLMMessage,
    tools: RepositoryTools,
    maxTokens: number,
  ): Promise<LLMResponse> {
    const history: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: message.images?.length
          ? [
              { type: "text", text: message.content },
              ...message.images.map((image) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
              })),
            ]
          : message.content,
      },
    ];

    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; round < 9; round++) {
      const request: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        system,
        max_tokens: maxTokens,
        messages: history,
      };

      if (round < 8)
        request.tools = repositoryToolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }));
      const response = await this.client.messages.create(request, { signal: this.signal });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (calls.length === 0) {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        if (!text || response.stop_reason !== "end_turn")
          throw new Error("Incomplete Claude reply");

        return { text, usage: { inputTokens, outputTokens } };
      }

      history.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const call of calls) {
        const args = repositoryArgsSchema.safeParse(call.input);

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: args.success
            ? await tools.run(call.name, args.data)
            : "Invalid repository tool request.",
        });
      }

      history.push({ role: "user", content: results });
    }

    throw new Error("Repository tool round limit reached without a final reply");
  }

  async complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens: number = 2048,
  ): Promise<LLMResponse> {
    try {
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to Claude");

      const response = await this.client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.images?.length
              ? [
                  { type: "text" as const, text: m.content },
                  ...m.images.map((image) => ({
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: image.mediaType,
                      data: image.data,
                    },
                  })),
                ]
              : m.content,
          })),
        },
        { signal: this.signal },
      );

      if (
        response.stop_reason &&
        response.stop_reason !== "end_turn" &&
        response.stop_reason !== "stop_sequence"
      ) {
        throw new Error(`Incomplete Claude response: ${response.stop_reason}`);
      }

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      if (!textBlock) {
        throw new Error("No text block in Claude response");
      }

      this.logger.info(
        {
          model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        "Claude response received",
      );

      return {
        text: textBlock.text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      this.logger.error({ err: error, model }, "Claude API call failed");
      throw error;
    }
  }
}

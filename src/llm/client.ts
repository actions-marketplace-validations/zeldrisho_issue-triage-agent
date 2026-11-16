import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider, RepoTool, ToolCall, ToolCallResponse } from "./provider.js";

const DEFAULT_MAX_ROUNDS = 5;

const toolInputSchema = z
  .object({ command: z.string() })
  .transform((v): ToolCall["input"] => ({ name: "shell", command: v.command }));

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger, baseURL?: string) {
    const options: ConstructorParameters<typeof Anthropic>[0] = { apiKey };

    if (baseURL) options.baseURL = baseURL;

    this.client = new Anthropic(options);
    this.logger = logger.child({ module: "llm" });
  }

  async complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens: number = 2048,
  ): Promise<LLMResponse> {
    try {
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to Claude");

      const response = await this.client.messages.create({
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
      });

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

  async completeWithTools(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    tools: RepoTool[],
    runTool: (call: ToolCall) => Promise<string>,
    maxTokens: number = 2048,
    maxRounds: number = DEFAULT_MAX_ROUNDS,
  ): Promise<ToolCallResponse> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: t.parameters.properties,
        required: t.parameters.required,
      },
    }));

    // Build initial message list in Anthropic format
    const history: Anthropic.MessageParam[] = messages.map((m) => ({
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
    }));

    let totalInput = 0;
    let totalOutput = 0;
    let lastText = "";

    for (let round = 0; round < maxRounds; round++) {
      this.logger.debug({ model }, `Claude tool-call round ${round}`);

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: anthropicTools,
        messages: history,
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      // Collect any text from this response
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");

      if (textBlock) lastText = textBlock.text;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      // No tool calls → model is done
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        break;
      }

      // Append assistant turn to history
      history.push({ role: "assistant", content: response.content });

      // Execute tools and build result blocks
      const resultBlocks: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          let output: string;

          try {
            if (block.name !== "shell") throw new Error("Unknown tool");

            const parsed = toolInputSchema.safeParse(block.input);

            if (!parsed.success) {
              output = `Error: invalid tool input: ${parsed.error.message}`;
            } else {
              output = await runTool({ id: block.id, input: parsed.data });
            }
          } catch (err) {
            output = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: output,
          };
        }),
      );

      history.push({ role: "user", content: resultBlocks });
    }

    this.logger.info(
      { model, inputTokens: totalInput, outputTokens: totalOutput },
      "Claude tool-call loop complete",
    );

    return {
      text: lastText,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    };
  }
}

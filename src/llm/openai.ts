import OpenAI from "openai";
import { z } from "zod";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider, RepoTool, ToolCall, ToolCallResponse } from "./provider.js";

const DEFAULT_MAX_ROUNDS = 5;

const toolInputSchema = z
  .object({ command: z.string() })
  .transform((v): ToolCall["input"] => ({ name: "shell", command: v.command }));

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger, baseURL?: string) {
    const options: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

    if (baseURL) options.baseURL = baseURL;

    this.client = new OpenAI(options);
    this.logger = logger.child({ module: "llm" });
  }

  async complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens: number = 2048,
  ): Promise<LLMResponse> {
    try {
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to OpenAI");

      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
            if (m.role === "assistant" || !m.images?.length) {
              return { role: m.role, content: m.content };
            }

            return {
              role: "user",
              content: [
                { type: "text", text: m.content },
                ...m.images.map((image) => ({
                  type: "image_url" as const,
                  image_url: { url: `data:${image.mediaType};base64,${image.data}` },
                })),
              ],
            };
          }),
        ],
      });

      const text = response.choices[0]?.message?.content;

      if (!text) {
        throw new Error("No text content in OpenAI response");
      }

      this.logger.info(
        {
          model,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        "OpenAI response received",
      );

      return {
        text,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      this.logger.error({ err: error, model }, "OpenAI API call failed");
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
    const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: t.parameters.properties,
          required: t.parameters.required,
        },
      },
    }));

    const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
        if (m.role === "assistant" || !m.images?.length) {
          return { role: m.role, content: m.content };
        }

        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            ...m.images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: `data:${image.mediaType};base64,${image.data}` },
            })),
          ],
        };
      }),
    ];

    let totalInput = 0;
    let totalOutput = 0;
    let lastText = "";

    for (let round = 0; round < maxRounds; round++) {
      this.logger.debug({ model }, `OpenAI tool-call round ${round}`);

      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        tools: openAITools,
        messages: history,
      });

      totalInput += response.usage?.prompt_tokens ?? 0;
      totalOutput += response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) break;

      const textContent = assistantMessage.content;

      if (textContent) lastText = textContent;

      const toolCalls = assistantMessage.tool_calls;

      // No tool calls or model finished → done
      if (!toolCalls?.length || choice.finish_reason === "stop") {
        break;
      }

      // Append assistant turn
      history.push(assistantMessage);

      // Execute tools — only function-type tool calls carry a `.function` field
      await Promise.all(
        toolCalls
          .filter(
            (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
              tc.type === "function",
          )
          .map(async (tc) => {
            let output: string;

            try {
              if (tc.function.name !== "shell") throw new Error("Unknown tool");

              const rawArgs: unknown = tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {};

              const parsed = toolInputSchema.safeParse(rawArgs);

              if (!parsed.success) {
                output = `Error: invalid tool input: ${parsed.error.message}`;
              } else {
                output = await runTool({ id: tc.id, input: parsed.data });
              }
            } catch (err) {
              output = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }

            history.push({
              role: "tool",
              tool_call_id: tc.id,
              content: output,
            });
          }),
      );
    }

    this.logger.info(
      { model, inputTokens: totalInput, outputTokens: totalOutput },
      "OpenAI tool-call loop complete",
    );

    return {
      text: lastText,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    };
  }
}

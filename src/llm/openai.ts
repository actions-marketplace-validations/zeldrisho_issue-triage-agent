import OpenAI from "openai";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import { TruncatedResponseError, type LLMProvider } from "./provider.js";
import {
  repositoryArgsSchema,
  repositoryToolDefinitions,
  type RepositoryTools,
} from "./repository-tools.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private logger: Logger;
  private signal?: AbortSignal;

  constructor(apiKey: string, logger: Logger, baseURL?: string, signal?: AbortSignal) {
    this.signal = signal;

    const options: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey,
      timeout: 60_000,
      maxRetries: 1,
    };

    if (baseURL) options.baseURL = baseURL;

    this.client = new OpenAI(options);
    this.logger = logger.child({ module: "llm" });
  }

  async completeWithRepository(
    model: string,
    system: string,
    message: LLMMessage,
    tools: RepositoryTools,
    maxTokens: number,
  ): Promise<LLMResponse> {
    const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      {
        role: "user",
        content: message.images?.length
          ? [
              { type: "text", text: message.content },
              ...message.images.map((image) => ({
                type: "image_url" as const,
                image_url: { url: `data:${image.mediaType};base64,${image.data}` },
              })),
            ]
          : message.content,
      },
    ];

    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; round < 9; round++) {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        messages: history,
      };

      if (round < 8)
        request.tools = repositoryToolDefinitions.map((tool) => ({
          type: "function" as const,
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
      const response = await this.client.chat.completions.create(request, { signal: this.signal });

      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      const choice = response.choices[0];
      const assistant = choice?.message;

      if (!assistant) throw new Error("No OpenAI response");

      if (!assistant.tool_calls?.length) {
        if (!assistant.content || choice.finish_reason !== "stop" || assistant.refusal)
          throw new Error("Incomplete OpenAI reply");

        return { text: assistant.content, usage: { inputTokens, outputTokens } };
      }

      history.push(assistant);

      for (const call of assistant.tool_calls) {
        let result = "Invalid repository tool request.";

        if (call.type === "function") {
          try {
            const input = repositoryArgsSchema.safeParse(JSON.parse(call.function.arguments));

            if (input.success) result = await tools.run(call.function.name, input.data);
          } catch {
            // Invalid arguments do not execute a tool.
          }
        }

        history.push({ role: "tool", tool_call_id: call.id, content: result });
      }
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
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to OpenAI");

      const response = await this.client.chat.completions.create(
        {
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
        },
        { signal: this.signal },
      );

      const choice = response.choices[0];

      if (choice?.finish_reason === "length" && !choice.message?.refusal)
        throw new TruncatedResponseError("Incomplete OpenAI response: length");

      if (choice?.message?.refusal || (choice?.finish_reason && choice.finish_reason !== "stop")) {
        throw new Error("OpenAI response refused or incomplete");
      }

      const text = choice?.message?.content;

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
}

import OpenAI from "openai";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";

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
}

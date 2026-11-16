import type { LLMMessage, LLMResponse } from "./types.js";
import type { ToolProvider } from "./repository-tools.js";

export class TruncatedResponseError extends Error {}

export interface LLMProvider extends Partial<ToolProvider> {
  complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens?: number,
  ): Promise<LLMResponse>;
}

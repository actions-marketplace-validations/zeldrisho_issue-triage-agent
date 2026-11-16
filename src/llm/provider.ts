import type { LLMMessage, LLMResponse } from "./types.js";

export interface RepoTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Minimal JSON Schema object — only the fields we actually use. */
export interface JsonSchema {
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
}

/** Parsed, validated input for a single tool call. */
export type ToolInput = { name: "shell"; command: string };

export interface ToolCall {
  id: string;
  input: ToolInput;
}

export interface ToolCallResponse {
  /** Text emitted after the final tool round (the actual reply). */
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens?: number,
  ): Promise<LLMResponse>;

  /**
   * Agentic loop: call the model, execute any tool calls via `runTool`, repeat.
   * Optional — providers that don't implement it leave this undefined.
   */
  completeWithTools?(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    tools: RepoTool[],
    runTool: (call: ToolCall) => Promise<string>,
    maxTokens?: number,
    maxRounds?: number,
  ): Promise<ToolCallResponse>;
}

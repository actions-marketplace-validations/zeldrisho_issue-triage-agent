export interface LLMImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64-encoded image bytes. */
  data: string;
}

export type LLMMessage =
  | { role: "user"; content: string; images?: LLMImage[] }
  | { role: "assistant"; content: string; images?: never };

export interface LLMResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

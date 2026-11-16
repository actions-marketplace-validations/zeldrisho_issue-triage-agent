import type { LLMProvider } from "./provider.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { MediaResult } from "../media.js";

export function mediaMessage(content: string, media?: MediaResult): LLMMessage {
  const message: LLMMessage = {
    role: "user",
    content: content + (media?.notice ? `\n\nMedia availability:\n${media.notice}` : ""),
  };

  if (media?.images.length) message.images = media.images;

  return message;
}

/** Retry without images when a provider or model cannot accept a media request. */
export async function completeWithMediaFallback(
  provider: LLMProvider,
  model: string,
  system: string,
  message: LLMMessage,
  maxTokens: number,
): Promise<LLMResponse> {
  try {
    return await provider.complete(model, system, [message], maxTokens);
  } catch (error) {
    if (!message.images?.length) throw error;

    return provider.complete(
      model,
      system,
      [
        {
          role: "user",
          content:
            message.content +
            "\n\nThe images could not be sent to the model. All attachments described above as provided are actually unavailable; do not claim to have viewed them.",
        },
      ],
      maxTokens,
    );
  }
}

import { z } from "zod";
import type { LLMProvider } from "./provider.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { MediaResult } from "../media.js";
import type { RepositoryTools } from "./repository-tools.js";

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
  tools?: RepositoryTools,
): Promise<LLMResponse> {
  const complete = (input: LLMMessage) =>
    tools && provider.completeWithRepository
      ? provider.completeWithRepository(model, system, input, tools, maxTokens)
      : provider.complete(model, system, [input], maxTokens);

  const kind = (error: Error): "unsupported" | "invalid" | "other" => {
    const parsed = z.object({ status: z.literal(400), message: z.string() }).safeParse(error);

    if (!parsed.success || !/image|vision/i.test(parsed.data.message)) return "other";

    if (/unsupported|not support/i.test(parsed.data.message)) return "unsupported";

    if (
      /invalid|corrupt|malformed|too large|too big|dimension|size|exceed/i.test(parsed.data.message)
    )
      return "invalid";

    return "other";
  };

  const textOnly = () =>
    complete({
      role: "user",
      content:
        message.content +
        "\n\nThe images could not be sent to the model. All attachments described above as provided are actually unavailable; do not claim to have viewed them.",
    });

  try {
    return await complete(message);
  } catch (error) {
    const failure = z.instanceof(Error).safeParse(error);

    if (!message.images?.length || !failure.success) throw error;
    const failureKind = kind(failure.data);

    if (failureKind === "other") throw error;

    if (failureKind === "unsupported" || message.images.length === 1) return textOnly();

    const accepted: NonNullable<LLMMessage["images"]> = [];
    const positions: number[] = [];

    for (const [index, image] of message.images.entries()) {
      try {
        await provider.complete(
          model,
          "Briefly describe the supplied image.",
          [{ role: "user", content: "Describe this image.", images: [image] }],
          Math.min(maxTokens, 128),
        );
        accepted.push(image);
        positions.push(index + 1);
      } catch (probeError) {
        const probe = z.instanceof(Error).safeParse(probeError);

        if (!probe.success || kind(probe.data) === "other") throw probeError;

        if (kind(probe.data) === "unsupported") return textOnly();
      }
    }

    if (!accepted.length) return textOnly();

    return complete({
      role: "user",
      content:
        message.content +
        `\n\nOnly originally provided image positions ${positions.join(", ")} are available in this request; all other images are unavailable. Ignore conflicting availability notices.`,
      images: accepted,
    });
  }
}

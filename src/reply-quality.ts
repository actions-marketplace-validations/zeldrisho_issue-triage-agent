import type { LLMResponse } from "./llm/types.js";
import { BANNED_REPLY_PHRASES } from "./prompts/shared.js";
import { isNoReply, unwrapFullCodeFence } from "./reply-format.js";

export function replaceForbiddenDashes(text: string): string {
  const protectedParts: string[] = [];

  const protectedText = text.replace(/```[\s\S]*?```|`[^`]*`|\[[^\]]*\]\([^)]*\)/g, (part) => {
    const token = `__REPLY_PROTECTED_${protectedParts.length}__`;
    protectedParts.push(part);

    return token;
  });

  const cleaned = protectedText.replace(/(?<=\d)[—–](?=\d)/gu, "-").replace(/\s*[—–]\s*/gu, ", ");

  return cleaned.replace(
    /__REPLY_PROTECTED_(\d+)__/g,
    (_, index: string) => protectedParts[Number(index)],
  );
}

export function replyStyleViolations(text: string): string[] {
  const value = unwrapFullCodeFence(text);

  if (!value || isNoReply(value)) return [];

  const violations: string[] = [];

  if (/[—–]/u.test(value)) violations.push("em/en dash");

  if (/(?:\*\*[^*]+\*\*|__[^_]+__)/u.test(value)) violations.push("bold");

  if (/(?:^|\n)\s*#{1,6}\s+/u.test(value)) violations.push("heading");

  if (/(?:^|\n)\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(value)) violations.push("bullet");

  if (/\p{Extended_Pictographic}/u.test(value)) violations.push("emoji");

  if (
    /^\s*(?:thanks?\b|thank you\b|great\b|glad\b|excellent\b|good question\b|i appreciate\b)/i.test(
      value,
    )
  )
    violations.push("thank/praise opening");

  const lower = value.toLowerCase();

  for (const phrase of BANNED_REPLY_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const pattern =
      phrase === "noted"
        ? /(?<!\w)noted(?!\s+in\b)(?!\w)/i
        : new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i");

    if (pattern.test(lower)) violations.push(`banned phrase: ${phrase}`);
  }

  return violations;
}

export async function completeWithReplyStyleGate(
  message: string,
  complete: (message: string) => Promise<LLMResponse>,
  warn: (violations: string[]) => void,
): Promise<string> {
  const first = await complete(message);
  const firstText = unwrapFullCodeFence(first.text);
  const violations = replyStyleViolations(firstText);

  if (!violations.length) return firstText;

  try {
    const retry = await complete(
      `${message}\n\nStyle violations to fix: ${violations.join(", ")}. Return only the revised comment.`,
    );

    const retryText = unwrapFullCodeFence(retry.text);
    const retryViolations = replyStyleViolations(retryText);

    if (retryViolations.length) {
      warn(retryViolations);

      return replaceForbiddenDashes(retryText);
    }

    return retryText;
  } catch {
    warn(violations);

    return replaceForbiddenDashes(firstText);
  }
}

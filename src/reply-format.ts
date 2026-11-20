export const ISSUE_TRIAGE_SIGNATURE = "-- Issue Triage Agent :robot:";

export function unwrapFullCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceCount = trimmed.match(/```/g)?.length ?? 0;
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```$/i);

  return match && fenceCount === 2 ? match[1].trim() : trimmed;
}

export function isNoReply(text: string): boolean {
  return /^(?:NO_REPLY|`NO_REPLY`)\.?$/i.test(text.trim());
}

export function truncateReply(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const suffix = "\n\n... (reply truncated)";
  const budget = maxLength - suffix.length;
  const candidate = text.slice(0, Math.max(0, budget));
  const boundary = candidate.lastIndexOf("\n\n");

  const sentence = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?"),
  );

  const cut = boundary > budget * 0.5 ? boundary : sentence > budget * 0.5 ? sentence + 1 : budget;

  return candidate.slice(0, cut).trimEnd() + suffix;
}

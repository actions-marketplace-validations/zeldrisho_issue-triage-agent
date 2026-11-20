import { describe, expect, it, vi } from "vite-plus/test";
import {
  replyStyleViolations,
  completeWithReplyStyleGate,
  replaceForbiddenDashes,
} from "../src/reply-quality.js";

describe("reply style gate", () => {
  it.each([
    ["Thanks for reporting this.", "thank/praise opening"],
    ["Use **this**.", "bold"],
    ["# Status", "heading"],
    ["- Use this", "bullet"],
    ["This works 🚀", "emoji"],
    ["This — works", "em/en dash"],
    ["Feel free to ask.", "banned phrase: feel free to"],
  ])("detects %s", (text, violation) => {
    expect(replyStyleViolations(text)).toContain(violation);
  });

  it("replaces dashes without damaging ranges", () => {
    expect(replaceForbiddenDashes("Fix it — now; 10–20")).toBe("Fix it, now; 10-20");
    expect(replaceForbiddenDashes("[range](https://example.com/a–b) `10–20`")).toBe(
      "[range](https://example.com/a–b) `10–20`",
    );
  });

  it("uses phrase boundaries", () => {
    expect(replyStyleViolations("The denoted value is correct.")).not.toContain(
      "banned phrase: noted",
    );
    expect(replyStyleViolations("As noted in the changelog.")).not.toContain(
      "banned phrase: noted",
    );
    expect(replyStyleViolations("Noted for consideration.")).toContain("banned phrase: noted");
  });

  it("does not gate NO_REPLY", () => {
    expect(replyStyleViolations("NO_REPLY")).toEqual([]);
  });

  it("retries once and returns the clean response", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "Thanks for this.", usage: {} })
      .mockResolvedValueOnce({ text: "The fix needs a version.", usage: {} });

    const warn = vi.fn();
    await expect(completeWithReplyStyleGate("input", complete, warn)).resolves.toBe(
      "The fix needs a version.",
    );
    expect(complete).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("mechanically removes dashes after a failed retry", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "Still — not **clean**.", usage: {} });
    const warn = vi.fn();
    await expect(completeWithReplyStyleGate("input", complete, warn)).resolves.toBe(
      "Still, not **clean**.",
    );
    expect(warn).toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vite-plus/test";
import { buildReplyUserMessage } from "../src/prompts/reply.js";

describe("buildReplyUserMessage", () => {
  it("includes issue data with markers", () => {
    const result = buildReplyUserMessage("Bug title", "Bug body", "bug", "high", ["triage"]);
    expect(result).toContain("=== ISSUE DATA BEGIN");
    expect(result).toContain("=== ISSUE DATA END");
    expect(result).toContain("Title: Bug title");
    expect(result).toContain("Classification: bug (priority: high)");
    expect(result).toContain("Labels: triage");
    expect(result).toContain("Please draft a reply for this bug issue.");
  });

  it("bounds PR descriptions at the untrusted prompt boundary", () => {
    const result = buildReplyUserMessage(
      "Title",
      "Body",
      "bug",
      "low",
      [],
      [],
      [{ number: 2, title: "Fix", url: "url", body: "x".repeat(600) }],
    );

    expect(result).toContain("=== UNTRUSTED POTENTIALLY RELATED OPEN PULL REQUESTS BEGIN ===");
    expect(result).toContain("x".repeat(500));
    expect(result).not.toContain("x".repeat(501));
  });

  it("handles empty labels", () => {
    const result = buildReplyUserMessage("Title", "Body", "feature", "low", []);
    expect(result).toContain("Labels: (none)");
  });
});

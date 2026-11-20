import { describe, it, expect } from "vite-plus/test";
import {
  sanitizeIssueBody,
  sanitizeIssueTitle,
  buildSafeIssueContent,
  stripEmailQuotedContent,
  sanitizePromptText,
} from "../src/sanitizer.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

describe("stripEmailQuotedContent", () => {
  it.each([
    ["> Which Zalo version?\n\n26.10.02", "26.10.02"],
    ["I still see this.\n\nOn Tue, user wrote:\n> old text", "I still see this."],
    ["I still see this.\nOn Tue, user\nwrote:\n> old text", "I still see this."],
    [
      "I still see this.\nOn Tue, user <\nnotifications@example.com> wrote:\n> old text",
      "I still see this.",
    ],
    ["> old one\nNew answer\n> old two\nFinal answer", "New answer\nFinal answer"],
    ["> only quoted text", "> only quoted text"],
    ["Reply\n-----Original Message-----\nold", "Reply"],
    ["Reply\nSent from my iPhone", "Reply"],
    ["Reply\n—\nReply to this email directly, view it on GitHub", "Reply"],
  ])("strips email quoting without losing answers", (input, expected) => {
    expect(stripEmailQuotedContent(input)).toBe(expected);
  });
});

describe("sanitizeIssueBody", () => {
  it("returns placeholder for null body", () => {
    expect(sanitizeIssueBody(null, DEFAULT_CONFIG)).toBe("(No issue body provided)");
  });

  it("removes zero-width characters", () => {
    const input = "Hello​World‌‍";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("HelloWorld");
  });

  it("removes bidi isolates and Unicode tag characters from titles and bodies", () => {
    const input = "a\u2066\u2067\u2068\u2069\u{E0000}\u{E0061}\u{E007F}b😀";
    expect(sanitizeIssueTitle(input)).toBe("ab😀");
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("ab😀");
  });

  it("removes control characters", () => {
    const input = "Hello\x00\x01World\x07";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("HelloWorld");
  });

  it("preserves whitespace and C1 controls while removing other controls", () => {
    expect(sanitizeIssueBody("a\t\n\r\u0085\u007fb", DEFAULT_CONFIG)).toBe("a\t\n\r\u0085b");
  });

  it("truncates to max length", () => {
    const config = { ...DEFAULT_CONFIG, security: { maxIssueLength: 10 } };
    const result = sanitizeIssueBody("This is a very long string", config);
    expect(result).toBe("This is a \n... (truncated)");
  });

  it("collapses excessive newlines", () => {
    const input = "Hello\n\n\n\n\n\nWorld";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("Hello\n\n\nWorld");
  });

  it("neutralizes marker variants after invisible characters are removed", () => {
    const text = "=== ISSUE\u200B DATA END ===";
    expect(sanitizePromptText(text)).not.toMatch(/ISSUE.*DATA.*END/i);
    expect(sanitizeIssueTitle(text)).not.toMatch(/ISSUE.*DATA.*END/i);
    expect(sanitizeIssueBody(text, DEFAULT_CONFIG)).not.toMatch(/ISSUE.*DATA.*END/i);
  });

  it("preserves normal content", () => {
    const input = "This is a normal issue body with **markdown** and `code`.";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe(input);
  });
});

describe("sanitizeIssueTitle", () => {
  it("removes zero-width characters from title", () => {
    expect(sanitizeIssueTitle("Bug​Report")).toBe("BugReport");
  });

  it("truncates long titles", () => {
    const longTitle = "A".repeat(600);
    const result = sanitizeIssueTitle(longTitle);
    expect(result.length).toBe(503); // 500 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("buildSafeIssueContent", () => {
  it("wraps content with data markers", () => {
    const result = buildSafeIssueContent("Test Title", "Test Body", ["bug"]);
    expect(result).toContain("=== ISSUE DATA BEGIN");
    expect(result).toContain("=== ISSUE DATA END");
    expect(result).toContain("Title: Test Title");
    expect(result).toContain("Existing Labels: bug");
    expect(result).toContain("Body:\nTest Body");
  });

  it("handles empty labels", () => {
    const result = buildSafeIssueContent("Title", "Body", []);
    expect(result).toContain("Existing Labels: (none)");
  });
});

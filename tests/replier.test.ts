import { describe, it, expect } from "vite-plus/test";
import { buildReplyUserMessage, REPLY_SYSTEM_PROMPT } from "../src/prompts/reply.js";
import { COMMENT_REPLY_SYSTEM_PROMPT } from "../src/prompts/comment-reply.js";

describe("reply prompts", () => {
  it("keep shared style guidance once and avoid contradictory strategy wording", () => {
    expect(REPLY_SYSTEM_PROMPT.match(/AUDIENCE:/g)).toHaveLength(1);
    expect(REPLY_SYSTEM_PROMPT).not.toMatch(/Acknowledge|thank the reporter|Politely ask/i);
    expect(`${REPLY_SYSTEM_PROMPT}${COMMENT_REPLY_SYSTEM_PROMPT}`).not.toMatch(/[—–]/u);
  });
});

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

  it("includes a trusted voice sample only when supplied", () => {
    const withSample = buildReplyUserMessage("Title", "Body", "bug", "low", [], [], [], "Direct.");
    const withoutSample = buildReplyUserMessage("Title", "Body", "bug", "low", []);
    expect(withSample).toContain("TRUSTED MAINTAINER VOICE SAMPLE BEGIN");
    expect(withoutSample).not.toContain("TRUSTED MAINTAINER VOICE SAMPLE BEGIN");
  });

  it("handles empty labels", () => {
    const result = buildReplyUserMessage("Title", "Body", "feature", "low", []);
    expect(result).toContain("Labels: (none)");
  });
});

import { describe, expect, it } from "vite-plus/test";
import { unwrapFullCodeFence } from "../src/reply-format.js";

describe("unwrapFullCodeFence", () => {
  it("unwraps one full fence", () => {
    expect(unwrapFullCodeFence("```\ntext\n```\n")).toBe("text");
  });

  it("preserves prose between separate fences", () => {
    const text = "```\nfirst\n```\nprose\n```\nsecond\n```";
    expect(unwrapFullCodeFence(text)).toBe(text);
  });

  it("preserves text without a fence", () => {
    expect(unwrapFullCodeFence("plain text")).toBe("plain text");
  });
});

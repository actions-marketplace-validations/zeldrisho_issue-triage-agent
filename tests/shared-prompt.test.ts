import { describe, expect, it } from "vite-plus/test";
import { relatedIssueStatus } from "../src/prompts/shared.js";

describe("relatedIssueStatus", () => {
  it.each([
    [{ state: "open" as const }, "open, already tracked"],
    [{ state: "closed" as const, stateReason: "completed" }, "closed as completed"],
    [{ state: "closed" as const, stateReason: "not_planned" }, "closed as not planned"],
    [{ state: "closed" as const, stateReason: "duplicate" }, "closed as duplicate"],
    [{ state: "closed" as const }, "closed (reason not recorded)"],
  ])("maps %j", (issue, expected) => {
    expect(relatedIssueStatus(issue)).toBe(expected);
  });
});

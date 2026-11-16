import { describe, it, expect } from "vite-plus/test";
import { parseClassificationResponse } from "../src/classifier.js";

describe("parseClassificationResponse", () => {
  it("parses valid JSON response", () => {
    const input = JSON.stringify({
      category: "bug",
      priority: "high",
      confidence: 0.92,
      summary: "App crashes on save",
      suggestedLabels: ["bug", "crash"],
      reasoning: "Clear crash report with steps",
    });

    const result = parseClassificationResponse(input);
    expect(result.category).toBe("bug");
    expect(result.priority).toBe("high");
    expect(result.confidence).toBe(0.92);
    expect(result.summary).toBe("App crashes on save");
    expect(result.suggestedLabels).toEqual(["bug", "crash"]);
  });

  it("parses JSON wrapped in markdown code block", () => {
    const json = JSON.stringify({
      category: "feature",
      priority: "low",
      confidence: 0.8,
      summary: "Request dark mode",
      suggestedLabels: ["enhancement"],
      reasoning: "Feature request",
    });

    const input = "```json\n" + json + "\n```";
    const result = parseClassificationResponse(input);
    expect(result.category).toBe("feature");
    expect(result.priority).toBe("low");
  });

  it("rejects an invalid category", () => {
    const input = JSON.stringify({
      category: "unknown_type",
      priority: "medium",
      confidence: 0.5,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    });

    expect(() => parseClassificationResponse(input)).toThrow("Invalid classification response");
  });

  it("rejects an invalid priority", () => {
    const input = JSON.stringify({
      category: "bug",
      priority: "urgent",
      confidence: 0.5,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    });

    expect(() => parseClassificationResponse(input)).toThrow("Invalid classification response");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseClassificationResponse("This is not JSON at all")).toThrow(
      "Invalid classification response",
    );
  });

  it("preserves zero confidence and rejects malformed field types", () => {
    expect(
      parseClassificationResponse('{"category":"bug","priority":"low","confidence":0}').confidence,
    ).toBe(0);
    expect(() =>
      parseClassificationResponse('{"category":"bug","priority":"low","summary":{"x":1}}'),
    ).toThrow("Invalid classification response");
  });

  it("clamps confidence to 0-1 range", () => {
    const input = JSON.stringify({
      category: "bug",
      priority: "high",
      confidence: 5.0,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    });

    const result = parseClassificationResponse(input);
    expect(result.confidence).toBe(1);
  });

  it("limits suggestedLabels to 5 items", () => {
    const input = JSON.stringify({
      category: "bug",
      priority: "high",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: ["a", "b", "c", "d", "e", "f", "g"],
      reasoning: "Test",
    });

    const result = parseClassificationResponse(input);
    expect(result.suggestedLabels.length).toBe(5);
  });
});

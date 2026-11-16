import { z } from "zod";
import type { Logger } from "./types.js";
import type { GitHubIssue, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import { DUPLICATE_SYSTEM_PROMPT, buildDuplicateUserMessage } from "./prompts/duplicate.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";

export interface DuplicateResponse {
  duplicates: number[];
  reasoning: string;
}

export function parseDuplicateResponse(raw: string): DuplicateResponse {
  const stripped = raw.trim();

  let jsonStr = stripped;
  const codeBlockMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);

  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    const values = z.array(z.unknown()).safeParse(parsed.duplicates);
    const duplicates: number[] = [];

    if (values.success) {
      for (const value of values.data) {
        const number = z.number().safeParse(value);

        if (number.success) duplicates.push(number.data);
      }
    }

    const reasoning = z.string().safeParse(parsed.reasoning);

    return {
      duplicates,
      reasoning: reasoning.success ? reasoning.data.slice(0, 300) : "No reasoning provided",
    };
  } catch {
    return { duplicates: [], reasoning: "Failed to parse duplicate detection response" };
  }
}

export async function detectDuplicates(
  issue: GitHubIssue,
  candidates: RelatedIssue[],
  llmClient: LLMProvider,
  config: RepoConfig,
  log: Logger,
): Promise<RelatedIssue[]> {
  if (candidates.length === 0) {
    return [];
  }

  const userMessage = buildDuplicateUserMessage(
    { title: sanitizeIssueTitle(issue.title), body: sanitizeIssueBody(issue.body, config) },
    candidates,
  );

  const response = await llmClient.complete(
    config.llm.model,
    DUPLICATE_SYSTEM_PROMPT,
    [{ role: "user", content: userMessage }],
    config.llm.maxTokens,
  );

  const result = parseDuplicateResponse(response.text);

  log.info(
    { duplicateNumbers: result.duplicates, reasoning: result.reasoning },
    "Duplicate detection completed",
  );

  return candidates.filter((c) => result.duplicates.includes(c.number));
}

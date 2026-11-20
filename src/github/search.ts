import type { Logger, RelatedIssue } from "../types.js";
import { MAX_RELATED_PR_BODY_LENGTH } from "./search-limits.js";

export async function searchSimilarIssues(
  owner: string,
  repo: string,
  title: string,
  issueNumber: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger?: Pick<Logger, "warn">,
): Promise<RelatedIssue[]> {
  const query = buildSearchQuery(title, owner, repo);

  const keywords = query.split("in:title ")[1]?.trim();

  if (!keywords) {
    return [];
  }

  const items: Array<{
    number: number;
    title: string;
    html_url: string;
    body?: string | null;
    pull_request?: unknown;
    state?: "open" | "closed";
    state_reason?: string | null;
    closed_at?: string | null;
    labels?: Array<{ name?: string }>;
  }> = [];

  let failures = 0;
  let lastError: unknown;

  for (const state of ["open", "closed"] as const) {
    try {
      const response = await octokit.rest.search.issuesAndPullRequests({
        q: buildSearchQuery(title, owner, repo, "issue", state),
        per_page: 10,
      });

      items.push(...response.data.items);
    } catch (error) {
      failures++;
      lastError = error;
      logger?.warn(`Failed to search ${state} issues for duplicates`);
    }
  }

  if (failures === 2) throw lastError;

  const seen = new Set<number>();

  const terms = title
    .toLowerCase()
    .replace(/^(feat|feature|bug|fix|docs?|question|chore|refactor)\s*:\s*/i, "")
    .split(/\W+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  return items
    .sort((a, b) => {
      const score = (value: string) =>
        terms.filter((term) => value.toLowerCase().includes(term)).length;

      return score(b.title) - score(a.title);
    })
    .flatMap((item) => {
      if (item.number === issueNumber || item.pull_request || seen.has(item.number)) return [];
      seen.add(item.number);

      return [
        {
          number: item.number,
          title: item.title,
          url: item.html_url,
          body: (item.body ?? "").slice(0, 2000),
          state: item.state,
          stateReason: item.state_reason,
          closedAt: item.closed_at,
          labels: (item.labels ?? []).map((label) => label.name ?? "").filter(Boolean),
        },
      ];
    });
}

export async function searchRelatedPullRequests(
  owner: string,
  repo: string,
  title: string,
  issueNumber: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
): Promise<RelatedIssue[]> {
  const query = buildSearchQuery(title, owner, repo, "pr", "open");

  if (!query.split("in:title ")[1]?.trim()) return [];

  const response = await octokit.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 5,
    sort: "updated",
    order: "desc",
  });

  return response.data.items
    .filter((item: { number: number }) => item.number !== issueNumber)
    .map((item: { number: number; title: string; html_url: string; body?: string | null }) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
      body: (item.body ?? "").slice(0, MAX_RELATED_PR_BODY_LENGTH),
    }));
}

export const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "not",
  "but",
  "are",
  "was",
  "has",
  "this",
  "that",
  "with",
  "from",
  "into",
  "can",
  "all",
  "its",
  "our",
]);

export function buildSearchQuery(
  title: string,
  owner: string,
  repo: string,
  type: "issue" | "pr" = "issue",
  state?: "open" | "closed",
): string {
  const words = title
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5)
    .join(" ");

  return `repo:${owner}/${repo} is:${type}${state ? ` is:${state}` : ""} in:title ${words}`;
}

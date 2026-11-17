import type { RelatedIssue } from "../types.js";

export async function searchSimilarIssues(
  owner: string,
  repo: string,
  title: string,
  issueNumber: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
): Promise<RelatedIssue[]> {
  const query = buildSearchQuery(title, owner, repo);

  const keywords = query.split("in:title ")[1]?.trim();

  if (!keywords) {
    return [];
  }

  const responses = await Promise.all(
    (["open", "closed"] as const).map((state) =>
      octokit.rest.search.issuesAndPullRequests({
        q: buildSearchQuery(title, owner, repo, "issue", state),
        per_page: 5,
        sort: "updated",
        order: "desc",
      }),
    ),
  );

  const seen = new Set<number>();

  return responses
    .flatMap((response) => response.data.items)
    .filter((item: { number: number; pull_request?: unknown }) => {
      if (item.number === issueNumber || item.pull_request || seen.has(item.number)) return false;
      seen.add(item.number);

      return true;
    })
    .map((item: { number: number; title: string; html_url: string; body?: string | null }) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
      body: (item.body ?? "").slice(0, 2000),
    }));
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
      body: (item.body ?? "").slice(0, 500),
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

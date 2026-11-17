import { describe, it, expect, vi } from "vite-plus/test";
import {
  buildSearchQuery,
  searchRelatedPullRequests,
  searchSimilarIssues,
} from "../src/github/search.js";

describe("searchSimilarIssues", () => {
  it("searches both states and merges distinct candidates excluding the current issue and PRs", async () => {
    const item = (number: number) => ({
      number,
      title: "title",
      html_url: "url",
      body: "x".repeat(3000),
    });

    const search = vi
      .fn()
      .mockResolvedValueOnce({
        data: { items: [item(1), item(2), { ...item(9), pull_request: {} }] },
      })
      .mockResolvedValueOnce({ data: { items: [item(2), item(3)] } });

    const result = await searchSimilarIssues("owner", "repo", "app crash", 1, {
      rest: { search: { issuesAndPullRequests: search } },
    });

    expect(search.mock.calls[0][0].q).toContain("is:issue is:open");
    expect(search.mock.calls[1][0].q).toContain("is:issue is:closed");
    expect(result.map((entry) => entry.number)).toEqual([2, 3]);
    expect(result[0].body).toHaveLength(2000);
  });

  it.each(["open", "closed"])(
    "retains successful results when the %s search fails",
    async (failed) => {
      const search = vi.fn().mockImplementation(async ({ q }: { q: string }) => {
        if (q.includes(`is:${failed}`)) throw new Error("unavailable");

        return { data: { items: [{ number: 2, title: "match", html_url: "url" }] } };
      });

      const warn = vi.fn();
      const logger = { warn };

      const result = await searchSimilarIssues(
        "owner",
        "repo",
        "app crash",
        1,
        { rest: { search: { issuesAndPullRequests: search } } },
        logger,
      );

      expect(result.map((item) => item.number)).toEqual([2]);
      expect(warn).toHaveBeenCalledWith(`Failed to search ${failed} issues for duplicates`);
    },
  );

  it("runs state searches serially", async () => {
    let resolveFirst!: (value: { data: { items: never[] } }) => void;

    const search = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ data: { items: never[] } }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: { items: [] } });

    const pending = searchSimilarIssues("owner", "repo", "app crash", 1, {
      rest: { search: { issuesAndPullRequests: search } },
    });

    expect(search).toHaveBeenCalledTimes(1);
    resolveFirst({ data: { items: [] } });
    await pending;
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("skips empty keywords and propagates search failures", async () => {
    const search = vi.fn().mockRejectedValue(new Error("unavailable"));
    const octokit = { rest: { search: { issuesAndPullRequests: search } } };
    expect(await searchSimilarIssues("owner", "repo", "a", 1, octokit)).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    await expect(searchSimilarIssues("owner", "repo", "app crash", 1, octokit)).rejects.toThrow(
      "unavailable",
    );
  });
});

describe("searchRelatedPullRequests", () => {
  it("searches open PRs in the same repository and bounds descriptions", async () => {
    const search = vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            number: 4,
            title: "Fix crash",
            html_url: "https://github.com/owner/repo/pull/4",
            body: "x".repeat(3000),
          },
        ],
      },
    });

    const result = await searchRelatedPullRequests("owner", "repo", "App crashes on save", 1, {
      rest: { search: { issuesAndPullRequests: search } },
    });

    expect(search.mock.calls[0][0].q).toContain("repo:owner/repo is:pr is:open");
    expect(result[0].body).toHaveLength(500);
  });

  it("does not search without usable keywords", async () => {
    const search = vi.fn();
    expect(
      await searchRelatedPullRequests("owner", "repo", "a", 1, {
        rest: { search: { issuesAndPullRequests: search } },
      }),
    ).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("buildSearchQuery", () => {
  it("builds query with keyword extraction", () => {
    const query = buildSearchQuery("Login page crashes on Chrome 120", "owner", "repo");

    expect(query).toContain("repo:owner/repo");
    expect(query).toContain("is:issue");
    expect(query).not.toContain("is:open");
    expect(query).toContain("in:title");
  });

  it("filters short words and stop words", () => {
    const query = buildSearchQuery("a bug in the app", "owner", "repo");

    expect(query).not.toContain(" a ");
    expect(query).not.toContain(" in ");
    expect(query).not.toContain(" the ");
  });

  it("limits to 5 keywords", () => {
    const longTitle = "one two three four five six seven eight nine ten";
    const query = buildSearchQuery(longTitle, "owner", "repo");

    const keywordPart = query.split("in:title ")[1];
    const words = keywordPart.split(" ");
    expect(words.length).toBeLessThanOrEqual(5);
  });

  it("strips special characters", () => {
    const query = buildSearchQuery("Bug: [API] crash!!! @#$", "owner", "repo");

    expect(query).not.toContain("[");
    expect(query).not.toContain("!");
    expect(query).not.toContain("@");
  });
});

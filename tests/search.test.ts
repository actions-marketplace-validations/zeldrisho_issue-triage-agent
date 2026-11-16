import { describe, it, expect, vi } from "vite-plus/test";
import { buildSearchQuery, searchRelatedPullRequests } from "../src/github/search.js";

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
    expect(result[0].body).toHaveLength(2000);
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

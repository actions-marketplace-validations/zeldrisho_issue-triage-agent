import { z } from "zod";
import type { ActionContext } from "../types.js";
import { ISSUE_TRIAGE_SIGNATURE } from "../reply-format.js";

const markerPattern = /<!-- issue-triage-agent:(?:issue|comment):\d+ -->/g;

export function replyMarker(actx: ActionContext): string {
  return actx.eventName === "issue_comment"
    ? `<!-- issue-triage-agent:comment:${actx.payload.comment?.id ?? 0} -->`
    : `<!-- issue-triage-agent:issue:${actx.payload.issue.number} -->`;
}

export function markReply(text: string, marker: string): string {
  const clean = text
    .replace(markerPattern, "")
    .replace(/(?:^|\n)\s*-- Issue Triage Agent\s*(?::robot:|🤖)?\s*$/i, "")
    .trim();

  return `${clean}\n\n${ISSUE_TRIAGE_SIGNATURE}\n\n${marker}`;
}

export async function replyAlreadyPosted(actx: ActionContext, marker: string): Promise<boolean> {
  const login = actx.botLogin ?? "github-actions[bot]";

  for (let page = 1; page <= 20; page++) {
    const response = await actx.octokit.rest.issues.listComments({
      owner: actx.owner,
      repo: actx.repo,
      issue_number: actx.payload.issue.number,
      per_page: 100,
      page,
    });

    const comments = z
      .array(
        z.object({ body: z.string().nullish(), user: z.object({ login: z.string() }).nullish() }),
      )
      .parse(response.data);

    if (
      comments.some(
        (comment) =>
          comment.user?.login.toLowerCase() === login.toLowerCase() &&
          comment.body?.includes(marker),
      )
    )
      return true;

    if (comments.length < 100) return false;
  }

  throw new Error("Too many issue comments to safely check for an existing reply");
}

import { z } from "zod";
import type { ActionContext } from "./types.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle, stripEmailQuotedContent } from "./sanitizer.js";
import { createProvider } from "./llm/factory.js";
import { processMedia } from "./media.js";
import { repositoryTools } from "./github/repository-context.js";
import { markReply, replyAlreadyPosted, replyMarker } from "./github/reply-dedup.js";
import { completeWithMediaFallback, mediaMessage } from "./llm/media-completion.js";
import { COMMENT_REPLY_SYSTEM_PROMPT, buildCommentReplyMessage } from "./prompts/comment-reply.js";
import { MEDIA_UNTRUSTED_NOTICE, REPOSITORY_TOOLS_UNAVAILABLE } from "./prompts/shared.js";
import { isNoReply, truncateReply } from "./reply-format.js";
import { completeWithReplyStyleGate } from "./reply-quality.js";
import { loadVoiceSample } from "./voice.js";

const MAX_COMMENT_REPLY_LENGTH = 4000;
const MAX_COMMENT_LENGTH = 5000;

export async function handleComment(actx: ActionContext): Promise<void> {
  if (actx.payload.sender?.type === "Bot") {
    return;
  }

  const issue = actx.payload.issue;

  if (issue.pull_request) {
    return;
  }

  const comment = actx.payload.comment;

  if (!comment) {
    return;
  }

  const issueNumber = issue.number;

  actx.logger.info(
    { owner: actx.owner, repo: actx.repo, issueNumber, commentAuthor: comment.user?.login },
    "Comment created on issue",
  );

  const config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath);

  if (!config.enabled || !config.features.commentReply) {
    return;
  }

  if (
    !config.features.commentReplyOnClosed &&
    (issue.state === "closed" || issue.locked === true)
  ) {
    actx.logger.info("Comment reply skipped for closed or locked issue");

    return;
  }

  if (
    (comment.user && config.exclude.users.includes(comment.user.login)) ||
    (issue.user && config.exclude.users.includes(issue.user.login)) ||
    (issue.labels ?? []).some((label) => config.exclude.labels.includes(label.name))
  ) {
    return;
  }

  const commentBody = stripEmailQuotedContent(comment.body ?? "").slice(0, MAX_COMMENT_LENGTH);

  const llmClient = createProvider(config.llm.provider, actx.logger, actx.signal);

  if (!llmClient) {
    actx.logger.warn("No LLM API key configured, skipping comment reply");

    return;
  }

  actx.repositoryRef = config.repositoryRef ?? actx.payload.repository.default_branch;
  const issueTitle = sanitizeIssueTitle(issue.title);
  const issueBody = sanitizeIssueBody(issue.body, config);
  const issueLabels = (issue.labels ?? []).map((l: { name: string }) => l.name);

  try {
    const marker = replyMarker(actx);

    if (await replyAlreadyPosted(actx, marker)) {
      actx.logger.info("Reply already posted for this event, skipping");

      return;
    }

    const maintainerAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
    const botLogin = (actx.botLogin ?? "github-actions[bot]").toLowerCase();
    let maintainerSinceBot = false;
    const history: Array<{ author: string; body: string; author_association?: string }> = [];

    for (let page = 1; page <= 20; page++) {
      const response = await actx.octokit.rest.issues.listComments({
        owner: actx.owner,
        repo: actx.repo,
        issue_number: issueNumber,
        per_page: 100,
        page,
      });

      const entries = z
        .array(
          z.object({
            id: z.number(),
            body: z.string().nullish(),
            user: z.object({ login: z.string() }).nullish(),
            author_association: z.string().nullish(),
          }),
        )
        .parse(response.data);

      for (const entry of entries) {
        if (entry.id >= comment.id) continue;
        const login = String(entry.user?.login ?? "unknown");
        const association = String(entry.author_association ?? "").toUpperCase();

        if (login.toLowerCase() === botLogin) maintainerSinceBot = false;
        else if (maintainerAssociations.has(association)) maintainerSinceBot = true;
        history.push({
          author: String(entry.user?.login ?? "unknown").slice(0, 100),
          author_association: entry.author_association ?? undefined,
          body: stripEmailQuotedContent(String(entry.body ?? ""))
            .replace(/<!--\s*issue-triage-agent:[\s\S]*?-->/g, "")
            .slice(0, 2000),
        });

        if (history.length > 10) history.shift();
      }

      if (entries.length < 100 || entries.some((entry) => entry.id === comment.id)) break;

      if (page === 20) throw new Error("Too many comments to safely collect conversation history");
    }

    if (
      config.features.skipMaintainerComments &&
      (maintainerAssociations.has(String(comment.author_association ?? "").toUpperCase()) ||
        maintainerSinceBot)
    )
      return;

    const voiceSample = await loadVoiceSample(actx);

    const userMessage = buildCommentReplyMessage({
      issueTitle,
      issueBody,
      issueLabels,
      commentAuthor: comment.user?.login ?? "unknown",
      commentBody,
      history,
      voiceSample,
    });

    const media = await processMedia([commentBody, issueBody], config.features.media, actx.signal);

    let replyText = await completeWithReplyStyleGate(
      userMessage,
      (message) =>
        completeWithMediaFallback(
          llmClient,
          config.llm.model,
          COMMENT_REPLY_SYSTEM_PROMPT +
            (media.notice ? `\n${MEDIA_UNTRUSTED_NOTICE}` : "") +
            (config.features.repositoryContext ? "" : `\n${REPOSITORY_TOOLS_UNAVAILABLE}`),
          mediaMessage(message, media),
          config.llm.maxTokens,
          config.features.repositoryContext ? repositoryTools(actx) : undefined,
        ),
      (violations) => actx.logger.warn(`Comment reply style violations: ${violations.join(", ")}`),
    );

    if (!replyText || isNoReply(replyText)) {
      actx.logger.info("No follow-up reply needed");

      return;
    }

    if (replyText.length > MAX_COMMENT_REPLY_LENGTH) {
      replyText = truncateReply(replyText, MAX_COMMENT_REPLY_LENGTH);
    }

    actx.signal?.throwIfAborted();
    await actx.octokit.rest.issues.createComment({
      owner: actx.owner,
      repo: actx.repo,
      issue_number: issueNumber,
      body: markReply(replyText, marker),
    });

    actx.logger.info({ issueNumber, replyLength: replyText.length }, "Comment reply posted");
  } catch (error) {
    actx.logger.error({ err: error, issueNumber }, "Failed to post comment reply");
  }
}

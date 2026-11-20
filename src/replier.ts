import type { Logger } from "./types.js";
import type { GitHubIssue, IssueClassification, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import type { MediaResult } from "./media.js";
import type { RepositoryTools } from "./llm/repository-tools.js";
import { completeWithMediaFallback, mediaMessage } from "./llm/media-completion.js";
import { REPLY_SYSTEM_PROMPT, buildReplyUserMessage } from "./prompts/reply.js";
import { MEDIA_UNTRUSTED_NOTICE, REPOSITORY_TOOLS_UNAVAILABLE } from "./prompts/shared.js";
import { truncateReply } from "./reply-format.js";
import { completeWithReplyStyleGate } from "./reply-quality.js";

const MAX_REPLY_LENGTH = 4000;

export async function draftReply(
  issue: GitHubIssue,
  classification: IssueClassification | null,
  sanitizedBody: string,
  sanitizedTitle: string,
  config: RepoConfig,
  llmClient: LLMProvider,
  logger: Logger,
  media?: MediaResult,
  repositoryTools?: RepositoryTools,
  relatedIssues?: RelatedIssue[],
  relatedPullRequests?: RelatedIssue[],
  voiceSample?: string,
): Promise<string> {
  const userMessage = buildReplyUserMessage(
    sanitizedTitle,
    sanitizedBody,
    classification?.category ?? "unavailable",
    classification?.priority ?? "unavailable",
    issue.labels.map((l) => l.name),
    relatedIssues ?? classification?.relatedIssues,
    relatedPullRequests,
    voiceSample,
  );

  logger.info({ issueNumber: issue.number }, "Drafting reply");

  const replyText = await completeWithReplyStyleGate(
    userMessage,
    (message) =>
      completeWithMediaFallback(
        llmClient,
        config.llm.model,
        REPLY_SYSTEM_PROMPT +
          (media?.notice ? `\n${MEDIA_UNTRUSTED_NOTICE}` : "") +
          (repositoryTools ? "" : `\n${REPOSITORY_TOOLS_UNAVAILABLE}`),
        mediaMessage(message, media),
        config.llm.maxTokens,
        repositoryTools,
      ).then((response) => response),
    (violations) =>
      logger.warn(
        { issueNumber: issue.number },
        `Reply style violations: ${violations.join(", ")}`,
      ),
  ).then((text) => truncateReply(text, MAX_REPLY_LENGTH));

  logger.info({ issueNumber: issue.number, replyLength: replyText.length }, "Reply drafted");

  return replyText;
}

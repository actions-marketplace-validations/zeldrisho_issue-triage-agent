import { z } from "zod";
import type {
  ActionContext,
  GitHubIssue,
  Logger,
  PipelineResult,
  RelatedIssue,
  RepoConfig,
} from "./types.js";
import { createProvider } from "./llm/factory.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";
import { classifyIssue } from "./classifier.js";
import { draftReply } from "./replier.js";
import { resolveLabels, applyLabels } from "./github/labels.js";
import { searchSimilarIssues, searchRelatedPullRequests } from "./github/search.js";
import { detectDuplicates } from "./duplicate.js";
import { processMedia } from "./media.js";
import { repositoryTools } from "./github/repository-context.js";
import { markReply, replyAlreadyPosted, replyMarker } from "./github/reply-dedup.js";
import { loadVoiceSample } from "./voice.js";

function shouldExclude(payload: ActionContext["payload"], config: RepoConfig): boolean {
  const issue = payload.issue;
  const existingLabels = (issue.labels ?? []).map((l: { name: string }) => l.name);

  if (issue.user && config.exclude.users.includes(issue.user.login)) {
    return true;
  }

  for (const label of existingLabels) {
    if (config.exclude.labels.includes(label)) {
      return true;
    }
  }

  return false;
}

export async function runPipeline(actx: ActionContext): Promise<PipelineResult> {
  const result: PipelineResult = {
    classification: null,
    labelsApplied: [],
    replyPosted: false,
    labelingStatus: "not-run",
    errors: [],
  };

  const log: Logger = actx.logger;

  const config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath);
  actx.repositoryRef = config.repositoryRef ?? actx.payload.repository.default_branch;
  log.info(`Repository evidence ref: ${actx.repositoryRef}`);

  if (!config.enabled) {
    log.info("Bot disabled for this repo, skipping");

    return result;
  }

  if (shouldExclude(actx.payload, config)) {
    log.info("Issue excluded by config, skipping");

    return result;
  }

  const issue: GitHubIssue = {
    number: actx.payload.issue.number,
    title: actx.payload.issue.title,
    body: actx.payload.issue.body ?? null,
    html_url: actx.payload.issue.html_url,
    user: { login: actx.payload.issue.user?.login ?? "unknown" },
    labels: (actx.payload.issue.labels ?? []).map((l: { name: string; id: number }) => ({
      name: l.name,
      id: l.id,
    })),
    created_at: actx.payload.issue.created_at,
  };

  const sanitizedTitle = sanitizeIssueTitle(issue.title);
  const sanitizedBody = sanitizeIssueBody(issue.body, config);

  const llmClient = createProvider(config.llm.provider, log, actx.signal);

  if (!llmClient) {
    log.warn("No LLM API key configured — skipping issue triage without making changes");

    return result;
  }

  const media =
    llmClient && (config.features.classify || config.features.reply)
      ? await processMedia([sanitizedBody], config.features.media, actx.signal)
      : undefined;

  actx.signal?.throwIfAborted();

  if (config.features.classify) {
    try {
      result.classification = await classifyIssue(
        issue,
        sanitizedBody,
        sanitizedTitle,
        config,
        llmClient,
        log,
        media,
      );

      try {
        let eligible = result.classification.confidence >= config.labeling.minConfidence;

        if (!eligible) {
          result.labelingStatus = "skipped-confidence";
          log.info(
            {
              confidence: result.classification.confidence,
              minConfidence: config.labeling.minConfidence,
            },
            "Labeling skipped due to confidence threshold",
          );
        }

        if (eligible && (config.labeling.skipAssigned || config.labeling.skipLabeled)) {
          const current = await actx.octokit.rest.issues.get({
            owner: actx.owner,
            repo: actx.repo,
            issue_number: issue.number,
          });

          const state = z
            .object({ assignees: z.array(z.unknown()), labels: z.array(z.unknown()) })
            .parse(current.data);

          if (config.labeling.skipAssigned && state.assignees.length > 0) {
            result.labelingStatus = "skipped-assigned";
            eligible = false;
          } else if (config.labeling.skipLabeled && state.labels.length > 0) {
            result.labelingStatus = "skipped-labeled";
            eligible = false;
          }
        }

        if (eligible) {
          const labels = resolveLabels(result.classification, config);
          result.labelsApplied = await applyLabels(
            actx.owner,
            actx.repo,
            actx.payload.issue.number,
            labels,
            actx.octokit,
            actx.logger,
          );

          if (labels.length > 0 && result.labelsApplied.length === 0) {
            result.labelingStatus = "failed";
            result.errors.push({ step: "label", message: "Failed to apply labels" });
          } else {
            result.labelingStatus =
              result.labelsApplied.length === labels.length ? "applied" : "partial";
            log.info({ labels: result.labelsApplied }, "Labels applied");
          }
        } else {
          log.info("Labeling skipped by eligibility policy");
        }
      } catch (error) {
        result.labelingStatus = "failed";
        result.errors.push({
          step: "label",
          message: "Failed to apply labels",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    } catch (error) {
      result.errors.push({
        step: "classify",
        message: "Classification failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  actx.signal?.throwIfAborted();

  let relatedIssues: RelatedIssue[] = [];

  if (config.features.duplicateSearch && llmClient) {
    try {
      const candidates = await searchSimilarIssues(
        actx.owner,
        actx.repo,
        sanitizedTitle,
        issue.number,
        actx.octokit,
        log,
      );

      if (candidates.length > 0) {
        log.info(
          { candidateCount: candidates.length },
          "Found similar issues, checking for duplicates",
        );
        relatedIssues = await detectDuplicates(issue, candidates, llmClient, config, log);

        if (result.classification) {
          result.classification.relatedIssues = relatedIssues;
        }

        log.info({ duplicateCount: relatedIssues.length }, "Duplicate detection completed");
      }
    } catch (error) {
      result.errors.push({
        step: "duplicate",
        message: "Duplicate detection failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  let relatedPullRequests: RelatedIssue[] = [];

  if (config.features.duplicateSearch && config.features.reply) {
    try {
      relatedPullRequests = await searchRelatedPullRequests(
        actx.owner,
        actx.repo,
        sanitizedTitle,
        issue.number,
        actx.octokit,
      );
    } catch (error) {
      result.errors.push({
        step: "related-pr",
        message: "Related pull request search failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  actx.signal?.throwIfAborted();

  if (config.features.reply) {
    try {
      const marker = replyMarker(actx);

      if (await replyAlreadyPosted(actx, marker)) {
        log.info("Reply already posted for this event, skipping");

        return result;
      }

      const voiceSample = await loadVoiceSample(actx);

      const replyBody = await draftReply(
        issue,
        result.classification,
        sanitizedBody,
        sanitizedTitle,
        config,
        llmClient,
        log,
        media,
        config.features.repositoryContext ? repositoryTools(actx) : undefined,
        relatedIssues,
        relatedPullRequests,
        voiceSample,
      );

      actx.signal?.throwIfAborted();
      await actx.octokit.rest.issues.createComment({
        owner: actx.owner,
        repo: actx.repo,
        issue_number: actx.payload.issue.number,
        body: markReply(replyBody, marker),
      });
      result.replyPosted = true;
      log.info("Reply comment posted");
    } catch (error) {
      result.errors.push({
        step: "reply",
        message: "Reply drafting/posting failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return result;
}

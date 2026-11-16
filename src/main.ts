import * as core from "@actions/core";
import * as github from "@actions/github";
import { z } from "zod";
import type { ActionContext, LogFields, Logger } from "./types.js";
import { runPipeline } from "./pipeline.js";
import { handleComment } from "./comment-handler.js";

function formatMessage(msgOrObj: string | LogFields, msg?: string): string {
  const message = z.string().safeParse(msgOrObj);

  return message.success ? message.data : `${msg ?? ""} ${JSON.stringify(msgOrObj)}`.trim();
}

function createActionLogger(): Logger {
  const logger: Logger = {
    info: (msgOrObj, msg) => core.info(formatMessage(msgOrObj, msg)),
    warn: (msgOrObj, msg) => core.warning(formatMessage(msgOrObj, msg)),
    error: (msgOrObj, msg) => core.error(formatMessage(msgOrObj, msg)),
    debug: (msgOrObj, msg) => core.debug(formatMessage(msgOrObj, msg)),
    child: () => logger,
  };

  return logger;
}

const eventPayloadSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    user: z.object({ login: z.string(), type: z.string().optional() }).nullish(),
    labels: z.array(z.object({ name: z.string(), id: z.number() })).optional(),
    created_at: z.string(),
    pull_request: z.unknown().optional(),
  }),
  comment: z
    .object({
      id: z.number(),
      body: z.string().nullable(),
      html_url: z.string(),
      user: z.object({ login: z.string() }).optional(),
      created_at: z.string(),
    })
    .optional(),
  sender: z.object({ login: z.string(), type: z.string().optional() }).optional(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
    default_branch: z.string(),
  }),
});

async function main(): Promise<void> {
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN;
  const anthropicKey = core.getInput("anthropic-api-key");
  const openaiKey = core.getInput("openai-api-key");

  for (const secret of [
    token,
    anthropicKey,
    openaiKey,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENAI_API_KEY,
  ]) {
    if (secret) core.setSecret(secret);
  }

  if (!token) {
    core.setFailed("github-token input or GITHUB_TOKEN env var is required");

    return;
  }

  const llmProvider = core.getInput("llm-provider");
  const configPath = core.getInput("config-path");

  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;

  if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;

  if (llmProvider && llmProvider !== "anthropic" && llmProvider !== "openai") {
    core.setFailed("llm-provider must be anthropic or openai");

    return;
  }

  if (llmProvider) process.env.LLM_PROVIDER = llmProvider;

  const llmModel = core.getInput("llm-model");

  if (llmModel) process.env.LLM_MODEL = llmModel;

  const llmBaseURL = core.getInput("llm-base-url");

  if (llmBaseURL) process.env.LLM_BASE_URL = llmBaseURL;

  const signal = AbortSignal.timeout(180_000);
  const octokit = github.getOctokit(token, { request: { signal } });
  const ctx = github.context;
  const { owner, repo } = ctx.repo;

  if (ctx.eventName !== "issues" && ctx.eventName !== "issue_comment") {
    core.warning(`Unsupported event: ${ctx.eventName}`);

    return;
  }

  const payload = eventPayloadSchema.safeParse(ctx.payload);

  if (!payload.success) {
    core.setFailed(`Invalid event payload: ${payload.error.message}`);

    return;
  }

  if (
    (ctx.eventName === "issues" && payload.data.action !== "opened") ||
    (ctx.eventName === "issue_comment" && payload.data.action !== "created")
  ) {
    core.info(`Ignoring unsupported ${ctx.eventName} action: ${payload.data.action}`);

    return;
  }

  const actx: ActionContext = {
    owner,
    repo,
    octokit,
    logger: createActionLogger(),
    configPath,
    botLogin: core.getInput("bot-login") || "github-actions[bot]",
    signal,
    eventName: ctx.eventName,
    payload: payload.data,
  };

  try {
    if (actx.eventName === "issues") {
      const result = await runPipeline(actx);
      signal.throwIfAborted();

      core.setOutput("category", result.classification?.category ?? "");
      core.setOutput("priority", result.classification?.priority ?? "");
      core.setOutput("labels-applied", result.labelsApplied.join(","));
      core.setOutput("reply-posted", String(result.replyPosted));

      for (const error of result.errors) {
        core.error(`Pipeline error (${error.step}): ${error.message}`);
      }
    } else if (actx.eventName === "issue_comment") {
      await handleComment(actx);
      signal.throwIfAborted();
    } else {
      core.warning(`Unsupported event: ${actx.eventName}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void main();

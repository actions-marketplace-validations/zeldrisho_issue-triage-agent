import { CORE_SCHEMA, loadAll, mergeTag, timestampTag, binaryTag, legacyMapTag } from "js-yaml";
import { z } from "zod";
import type { RepoConfig } from "../types.js";
import { DEFAULT_CONFIG, DEFAULT_MODELS } from "./schema.js";

const providerSchema = z.enum(["anthropic", "openai"]);

const configSchema = z.object({
  enabled: z.boolean().optional(),
  features: z
    .object({
      classify: z.boolean().optional(),
      reply: z.boolean().optional(),
      duplicateSearch: z.boolean().optional(),
      commentReply: z.boolean().optional(),
      media: z.boolean().optional(),
      repositoryContext: z.boolean().optional(),
    })
    .optional(),
  label_mapping: z.record(z.string(), z.array(z.string())).optional(),
  labeling: z
    .object({
      min_confidence: z.number().min(0).max(1).optional(),
      skip_assigned: z.boolean().optional(),
      skip_labeled: z.boolean().optional(),
    })
    .optional(),
  security: z.object({ max_issue_length: z.number().int().positive().optional() }).optional(),
  exclude: z
    .object({ labels: z.array(z.string()).optional(), users: z.array(z.string()).optional() })
    .optional(),
  llm: z
    .object({
      provider: providerSchema.optional(),
      model: z.string().trim().min(1).optional(),
      max_tokens: z.number().int().positive().max(8192).optional(),
    })
    .optional(),
});

export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  configPath: string = ".github/issue-triage-agent.yml",
): Promise<RepoConfig> {
  let repoConfig: z.infer<typeof configSchema> = {};

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
    });

    const file = z.object({ content: z.string() }).safeParse(data);

    if (file.success) {
      const yamlText = Buffer.from(file.data.content, "base64").toString("utf-8");

      const documents = loadAll(yamlText, {
        schema: CORE_SCHEMA.withTags(mergeTag, timestampTag, binaryTag, legacyMapTag),
      });

      if (documents.length > 1) {
        throw new Error("Expected a single YAML document");
      }

      repoConfig = configSchema.parse(documents[0] ?? {});
    }
  } catch (error: unknown) {
    const result = z.object({ status: z.literal(404) }).safeParse(error);

    if (!result.success) {
      throw error;
    }
  }

  const inputProvider = process.env.LLM_PROVIDER;

  const provider = inputProvider
    ? providerSchema.parse(inputProvider)
    : (repoConfig.llm?.provider ??
      (process.env.OPENAI_API_KEY ? "openai" : DEFAULT_CONFIG.llm.provider));

  return {
    enabled: repoConfig.enabled ?? DEFAULT_CONFIG.enabled,
    features: {
      classify: repoConfig.features?.classify ?? DEFAULT_CONFIG.features.classify,
      reply: repoConfig.features?.reply ?? DEFAULT_CONFIG.features.reply,
      duplicateSearch:
        repoConfig.features?.duplicateSearch ?? DEFAULT_CONFIG.features.duplicateSearch,
      commentReply: repoConfig.features?.commentReply ?? DEFAULT_CONFIG.features.commentReply,
      media: repoConfig.features?.media ?? DEFAULT_CONFIG.features.media,
      repositoryContext:
        repoConfig.features?.repositoryContext ?? DEFAULT_CONFIG.features.repositoryContext,
    },
    labelMapping: repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping,
    labeling: {
      minConfidence: repoConfig.labeling?.min_confidence ?? DEFAULT_CONFIG.labeling.minConfidence,
      skipAssigned: repoConfig.labeling?.skip_assigned ?? DEFAULT_CONFIG.labeling.skipAssigned,
      skipLabeled: repoConfig.labeling?.skip_labeled ?? DEFAULT_CONFIG.labeling.skipLabeled,
    },
    security: {
      maxIssueLength:
        repoConfig.security?.max_issue_length ?? DEFAULT_CONFIG.security.maxIssueLength,
    },
    exclude: {
      labels: repoConfig.exclude?.labels ?? DEFAULT_CONFIG.exclude.labels,
      users: repoConfig.exclude?.users ?? DEFAULT_CONFIG.exclude.users,
    },
    llm: {
      provider,
      model: process.env.LLM_MODEL?.trim() || (repoConfig.llm?.model ?? DEFAULT_MODELS[provider]),
      maxTokens: repoConfig.llm?.max_tokens ?? DEFAULT_CONFIG.llm.maxTokens,
    },
  };
}

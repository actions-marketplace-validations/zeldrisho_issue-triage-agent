import { CORE_SCHEMA, loadAll, mergeTag, timestampTag, binaryTag, legacyMapTag } from "js-yaml";
import { z } from "zod";
import type { RepoConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./schema.js";

export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  configPath: string = ".github/issue-ai.yml",
): Promise<RepoConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repoConfig: any;

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

      repoConfig = documents[0];
    } else {
      return DEFAULT_CONFIG;
    }
  } catch (error: unknown) {
    const result = z.object({ status: z.literal(404) }).safeParse(error);

    if (result.success) {
      return DEFAULT_CONFIG;
    }

    throw error;
  }

  if (!repoConfig) {
    return DEFAULT_CONFIG;
  }

  return {
    enabled: repoConfig.enabled ?? DEFAULT_CONFIG.enabled,
    features: {
      classify: repoConfig.features?.classify ?? DEFAULT_CONFIG.features.classify,
      reply: repoConfig.features?.reply ?? DEFAULT_CONFIG.features.reply,
      duplicateSearch:
        repoConfig.features?.duplicateSearch ?? DEFAULT_CONFIG.features.duplicateSearch,
      commentReply: repoConfig.features?.commentReply ?? DEFAULT_CONFIG.features.commentReply,
    },
    labelMapping: repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping,
    security: {
      maxIssueLength:
        repoConfig.security?.max_issue_length ?? DEFAULT_CONFIG.security.maxIssueLength,
    },
    exclude: {
      labels: repoConfig.exclude?.labels ?? DEFAULT_CONFIG.exclude.labels,
      users: repoConfig.exclude?.users ?? DEFAULT_CONFIG.exclude.users,
    },
    llm: {
      provider: repoConfig.llm?.provider ?? DEFAULT_CONFIG.llm.provider,
      model: repoConfig.llm?.model ?? DEFAULT_CONFIG.llm.model,
      maxTokens: repoConfig.llm?.max_tokens ?? DEFAULT_CONFIG.llm.maxTokens,
    },
  };
}

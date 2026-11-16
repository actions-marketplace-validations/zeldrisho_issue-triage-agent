import { z } from "zod";
import type { LLMMessage, LLMResponse } from "./types.js";

export const repositoryArgsSchema = z.object({
  query: z.string().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  path: z.string().max(4096).optional(),
});

export interface RepositoryTools {
  run(name: string, input: z.infer<typeof repositoryArgsSchema>): Promise<string>;
}

export interface ToolProvider {
  completeWithRepository(
    model: string,
    system: string,
    message: LLMMessage,
    tools: RepositoryTools,
    maxTokens: number,
  ): Promise<LLMResponse>;
}

export const repositoryToolDefinitions = [
  {
    name: "list",
    description:
      "List repository paths at the selected commit. Use path to list a directory non-recursively when the recursive tree is truncated; query filters paths.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        offset: { type: "number" },
        path: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "search",
    description:
      "Search the GitHub code index for plain words in this repository. Results may be stale; read matching files to verify them at the selected commit.",
    parameters: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "read",
    description:
      "Read a page of a text file at the selected commit. Use nextOffset to read subsequent pages.",
    parameters: {
      type: "object" as const,
      properties: { path: { type: "string" }, offset: { type: "number" } },
      required: ["path"],
    },
  },
];

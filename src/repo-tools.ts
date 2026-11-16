import type { RepoTool, ToolCall } from "./llm/provider.js";
import { getWorkspace, runCommand } from "./shell-tools.js";

export const REPO_TOOLS: RepoTool[] = [
  {
    name: "shell",
    description:
      "Run a read-only shell command inside the repository root. " +
      "Allowed commands: ls, cat, grep, find, head, tail, wc. " +
      "No pipes or shell expansion — pass arguments directly. " +
      "Examples: 'ls src/', 'cat README.md', 'grep -r TODO src/', 'find . -name \"*.ts\"'.",
    parameters: {
      properties: {
        command: {
          type: "string",
          description: "The command and arguments to run, e.g. 'ls src/' or 'cat package.json'",
        },
      },
      required: ["command"],
    },
  },
];

/**
 * Returns a tool runner bound to the current workspace, or null when the
 * workspace is not available (repo not checked out).
 */
export function createToolRunner(): ((call: ToolCall) => Promise<string>) | null {
  const workspace = getWorkspace();

  if (!workspace) return null;

  return async (call: ToolCall): Promise<string> => {
    const result = await runCommand(workspace, call.input.command);

    return result.stdout;
  };
}

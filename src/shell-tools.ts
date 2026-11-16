import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB
const TOOL_TIMEOUT_MS = 10_000;

/** Returns the workspace root, or null when the repo is not checked out. */
export function getWorkspace(): string | null {
  const ws = process.env.GITHUB_WORKSPACE;

  return ws && ws.trim() ? ws.trim() : null;
}

/** Allowed read-only commands. */
const ALLOWED_COMMANDS = new Set(["ls", "cat", "grep", "find", "head", "tail", "wc"]);

export interface CommandResult {
  stdout: string;
  truncated: boolean;
}

/**
 * Run an arbitrary shell command string inside the workspace.
 * Splits on whitespace into argv — no shell expansion, no pipes.
 * Only commands in ALLOWED_COMMANDS are permitted.
 */
export async function runCommand(workspace: string, command: string): Promise<CommandResult> {
  const args = command.trim().split(/\s+/);
  const bin = args[0];

  if (!bin) return { stdout: "Error: empty command", truncated: false };

  if (!ALLOWED_COMMANDS.has(bin)) {
    return {
      stdout: `Error: command "${bin}" is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`,
      truncated: false,
    };
  }

  try {
    const { stdout } = await execFileAsync(bin, args.slice(1), {
      cwd: workspace,
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
    });

    return truncate(stdout);
  } catch (err: unknown) {
    // execFile rejects on non-zero exit too; return stderr/message as output
    const msg =
      err instanceof Error && "stderr" in err
        ? // SAFETY: execFile attaches stderr as a string property on its error
          // objects; the intersection type makes that explicit.
          String((err as NodeJS.ErrnoException & { stderr?: string }).stderr) || err.message
        : String(err);

    return { stdout: `Error: ${msg}`, truncated: false };
  }
}

function truncate(text: string): CommandResult {
  if (Buffer.byteLength(text) <= MAX_OUTPUT_BYTES) {
    return { stdout: text, truncated: false };
  }

  const notice = "\n... (output truncated)";

  const trimmed = Buffer.from(text)
    .subarray(0, MAX_OUTPUT_BYTES - Buffer.byteLength(notice))
    .toString("utf8");

  return { stdout: trimmed + notice, truncated: true };
}

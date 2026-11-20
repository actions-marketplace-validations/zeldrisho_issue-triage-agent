import { z } from "zod";
import type { ActionContext } from "./types.js";

const MAX_VOICE_SAMPLE_LENGTH = 6000;

export async function loadVoiceSample(actx: ActionContext): Promise<string | undefined> {
  try {
    const response = await actx.octokit.rest.repos.getContent({
      owner: actx.owner,
      repo: actx.repo,
      path: ".github/triage-voice.md",
      ref: actx.repositoryRef ?? actx.payload.repository.default_branch,
      request: { timeout: 5000, retries: 0, signal: actx.signal },
    });

    const parsed = z
      .object({ content: z.string(), encoding: z.literal("base64") })
      .safeParse(response.data);

    if (!parsed.success) return undefined;

    return (
      Buffer.from(parsed.data.content, "base64")
        .toString("utf8")
        .slice(0, MAX_VOICE_SAMPLE_LENGTH) || undefined
    );
  } catch {
    return undefined;
  }
}

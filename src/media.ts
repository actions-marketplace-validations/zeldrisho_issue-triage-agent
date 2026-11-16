import type { LLMImage } from "./llm/types.js";

// Hard limits apply even when processing untrusted repository content.
const MAX_ATTACHMENTS = 4;
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const HOSTS = new Set([
  "github.com",
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "secured-user-images.githubusercontent.com",
]);

const REDIRECT_HOSTS = new Set(["github-production-user-asset-6210df.s3.amazonaws.com"]);

export interface MediaResult {
  images: LLMImage[];
  notice: string;
}

function approved(url: URL, redirect = false): boolean {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(HOSTS.has(url.hostname) || (redirect && REDIRECT_HOSTS.has(url.hostname)))
  )
    return false;

  return (
    url.hostname !== "github.com" ||
    /^\/user-attachments\/assets\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)
  );
}

export function extractMediaUrls(text: string): string[] {
  const urls = text.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  const unique = new Set<string>();

  for (const raw of urls) {
    const candidate = raw.replace(/[),.;\]]+$/, "").replace(/&amp;/g, "&");

    try {
      const url = new URL(candidate);

      if (approved(url)) unique.add(url.href);
    } catch {
      /* Ignore malformed URLs. */
    }
  }

  return [...unique];
}

async function download(
  initial: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; type: string }> {
  let url = initial;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!approved(new URL(url), redirects > 0)) throw new Error("unapproved host");

      const response = await fetch(url, {
        redirect: "manual",
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location || redirects === 3) throw new Error("invalid redirect");
        url = new URL(location, url).href;
        continue;
      }

      if (!response.ok || !response.body) throw new Error("download failed");
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type))
        throw new Error("unsupported content type");
      const length = Number(response.headers.get("content-length"));

      if (length > MAX_BYTES) throw new Error("file too large");
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;
          size += value.byteLength;

          if (size > MAX_BYTES) throw new Error("file too large");
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }

      return { bytes: Buffer.concat(chunks), type };
    }

    throw new Error("too many redirects");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function validImage(bytes: Buffer, type: string): boolean {
  if (type === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));

  if (type === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));

  if (type === "image/gif") return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"));

  if (type === "image/webp")
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );

  return false;
}

async function processMediaInternal(
  texts: string[],
  enabled: boolean,
  signal?: AbortSignal,
): Promise<MediaResult> {
  const urls = [...new Set(texts.flatMap(extractMediaUrls))];

  if (!urls.length) return { images: [], notice: "" };
  const images: LLMImage[] = [];

  const notices: string[] = [
    "Attachments are numbered in the order their URLs were supplied. Available images are provided in that same order.",
  ];

  for (const [index, url] of urls.entries()) {
    // Do not put signed URLs or arbitrary user text into the trusted notice.
    if (!enabled || index >= MAX_ATTACHMENTS) {
      notices.push(`Attachment ${index + 1}: unavailable (disabled or attachment limit).`);
      continue;
    }

    signal?.throwIfAborted();

    try {
      const { bytes, type } = await download(url, signal);

      if (!validImage(bytes, type)) throw new Error("invalid image");
      // SAFETY: validImage accepts only the four media types supported by LLMImage.
      images.push({ mediaType: type as LLMImage["mediaType"], data: bytes.toString("base64") });
      notices.push(`Attachment ${index + 1}: image provided.`);
    } catch {
      notices.push(`Attachment ${index + 1}: unavailable; do not claim to have viewed it.`);
    }
  }

  return { images, notice: notices.join("\n") };
}

export async function processMedia(
  texts: string[],
  enabled: boolean,
  signal?: AbortSignal,
): Promise<MediaResult> {
  try {
    return await processMediaInternal(texts, enabled, signal);
  } catch {
    signal?.throwIfAborted();

    return {
      images: [],
      notice:
        "Media processing failed; attachments are unavailable. Do not claim to have viewed them.",
    };
  }
}

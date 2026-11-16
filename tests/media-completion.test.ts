import { expect, it, vi } from "vite-plus/test";
import { completeWithMediaFallback } from "../src/llm/media-completion.js";

it("retries without images and discloses their unavailability if vision fails", async () => {
  const complete = vi
    .fn()
    .mockRejectedValueOnce(new Error("vision unsupported"))
    .mockResolvedValueOnce({ text: "ok", usage: { inputTokens: 0, outputTokens: 0 } });

  const result = await completeWithMediaFallback(
    { complete },
    "model",
    "system",
    {
      role: "user",
      content: "Attachment 1: image provided.",
      images: [{ mediaType: "image/png", data: "YWJj" }],
    },
    100,
  );

  expect(result.text).toBe("ok");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][2][0].images).toBeUndefined();
  expect(complete.mock.calls[1][2][0].content).toContain("actually unavailable");
});

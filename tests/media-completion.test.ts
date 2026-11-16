import { expect, it, vi } from "vite-plus/test";
import { completeWithMediaFallback } from "../src/llm/media-completion.js";
import { TruncatedResponseError } from "../src/llm/provider.js";

it("retries without images and discloses their unavailability if vision fails", async () => {
  const complete = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error("vision unsupported"), { status: 400 }))
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

it("isolates rejected images and sends the remaining images together", async () => {
  const invalid = Object.assign(new Error("invalid image data"), { status: 400 });

  const complete = vi
    .fn()
    .mockRejectedValueOnce(invalid)
    .mockResolvedValueOnce({ text: "probe", usage: { inputTokens: 0, outputTokens: 0 } })
    .mockRejectedValueOnce(invalid)
    .mockResolvedValueOnce({ text: "final", usage: { inputTokens: 0, outputTokens: 0 } });

  const result = await completeWithMediaFallback(
    { complete },
    "model",
    "system",
    {
      role: "user",
      content: "Images supplied",
      images: [
        { mediaType: "image/png", data: "good" },
        { mediaType: "image/png", data: "bad" },
      ],
    },
    100,
  );

  expect(result.text).toBe("final");
  expect(complete).toHaveBeenCalledTimes(4);
  expect(complete.mock.calls[3][2][0].images).toEqual([{ mediaType: "image/png", data: "good" }]);
  expect(complete.mock.calls[3][2][0].content).toContain("all other images are unavailable");
});

it("retains an image when its probe reaches the output limit", async () => {
  const invalid = Object.assign(new Error("invalid image data"), { status: 400 });

  const complete = vi
    .fn()
    .mockRejectedValueOnce(invalid)
    .mockRejectedValueOnce(new TruncatedResponseError("output limit"))
    .mockRejectedValueOnce(invalid)
    .mockResolvedValueOnce({ text: "final", usage: { inputTokens: 0, outputTokens: 0 } });

  const images = [
    { mediaType: "image/png" as const, data: "good" },
    { mediaType: "image/png" as const, data: "bad" },
  ];

  await completeWithMediaFallback(
    { complete },
    "model",
    "system",
    { role: "user", content: "hi", images },
    100,
  );
  expect(complete.mock.calls[3][2][0].images).toEqual([images[0]]);
});

it("falls back to text if each image is rejected", async () => {
  const invalid = Object.assign(new Error("invalid image data"), { status: 400 });

  const complete = vi
    .fn()
    .mockRejectedValueOnce(invalid)
    .mockRejectedValueOnce(invalid)
    .mockRejectedValueOnce(invalid)
    .mockResolvedValueOnce({ text: "text only", usage: { inputTokens: 0, outputTokens: 0 } });

  const result = await completeWithMediaFallback(
    { complete },
    "model",
    "system",
    {
      role: "user",
      content: "hi",
      images: [
        { mediaType: "image/png", data: "a" },
        { mediaType: "image/png", data: "b" },
      ],
    },
    100,
  );

  expect(result.text).toBe("text only");
  expect(complete.mock.calls[3][2][0].images).toBeUndefined();
});

it("falls back without tools for explicit tool incompatibility and preserves images", async () => {
  const completeWithRepository = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error("model does not support tools"), { status: 400 }));

  const complete = vi
    .fn()
    .mockResolvedValue({ text: "ok", usage: { inputTokens: 0, outputTokens: 0 } });

  const message = {
    role: "user" as const,
    content: "hi",
    images: [{ mediaType: "image/png" as const, data: "YWJj" }],
  };

  await completeWithMediaFallback(
    { complete, completeWithRepository },
    "model",
    "system",
    message,
    100,
    { run: vi.fn() },
  );
  expect(complete).toHaveBeenCalledWith(
    "model",
    expect.stringContaining("Repository tools are unavailable"),
    [message],
    100,
  );
});

it("does not retry unrelated tool errors", async () => {
  const completeWithRepository = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error("invalid tool schema"), { status: 400 }));

  const complete = vi.fn();
  await expect(
    completeWithMediaFallback(
      { complete, completeWithRepository },
      "model",
      "system",
      { role: "user", content: "hi" },
      100,
      { run: vi.fn() },
    ),
  ).rejects.toThrow("invalid tool schema");
  expect(complete).not.toHaveBeenCalled();
});

it("does not retry generic provider failures", async () => {
  const complete = vi.fn().mockRejectedValue(new Error("network failure"));

  await expect(
    completeWithMediaFallback(
      { complete },
      "model",
      "system",
      { role: "user", content: "hi", images: [{ mediaType: "image/png", data: "YWJj" }] },
      100,
    ),
  ).rejects.toThrow("network failure");
  expect(complete).toHaveBeenCalledTimes(1);
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { extractMediaUrls, processMedia } from "../src/media.js";

const image = "https://user-images.githubusercontent.com/123/example.png";
const asset = "https://github.com/user-attachments/assets/abc-123";

afterEach(() => vi.unstubAllGlobals());

describe("attachment processing", () => {
  it("extracts GitHub URLs in HTML, Markdown and bare links, deduplicating them", () => {
    expect(extractMediaUrls(`<img src="${image}"> ![x](${image})\n${asset}`)).toEqual([
      image,
      asset,
    ]);
  });
  it("does not accept lookalike hosts, credentials, ports or arbitrary github.com paths", () => {
    expect(
      extractMediaUrls(
        "https://user-images.githubusercontent.com.evil.test/a https://evil@github.com/user-attachments/assets/abc https://github.com:444/user-attachments/assets/abc https://github.com/org/repo",
      ),
    ).toEqual([]);
  });
  it("provides supported images and describes their availability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("89504e470d0a1a0a0000", "hex"), {
        headers: { "content-type": "image/png" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const result = await processMedia([image], true);
    expect(result.images).toEqual([{ mediaType: "image/png", data: "iVBORw0KGgoAAA==" }]);
    expect(result.notice).toContain("Attachment 1: image provided");
  });
  it("rejects redirects to unapproved hosts without fetching them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://localhost/private" } }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const result = await processMedia([asset], true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.notice).toContain("Attachment 1: unavailable");
  });
  it("follows a redirect to GitHub's specific asset bucket", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://github-production-user-asset-6210df.s3.amazonaws.com/file?signature=secret",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
          headers: { "content-type": "image/png" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    expect((await processMedia([asset], true)).images).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("marks videos unavailable without reading their bodies", async () => {
    const response = new Response("video data", { headers: { "content-type": "video/mp4" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await processMedia([asset], true);
    expect(result.images).toEqual([]);
    expect(result.notice).toContain("Attachment 1: unavailable");
    expect(response.bodyUsed).toBe(false);
  });
  it("marks wrong content types and invalid images unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("not an image", { headers: { "content-type": "image/png" } }),
        ),
    );
    expect((await processMedia([image], true)).notice).toContain("unavailable");
  });
  it("does not download when disabled or over the count limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("x", { headers: { "content-type": "text/html" } }));

    vi.stubGlobal("fetch", fetchMock);
    expect((await processMedia([image], false)).notice).toContain("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();

    const urls = Array.from(
      { length: 5 },
      (_, i) => `https://user-images.githubusercontent.com/${i}/a.png`,
    );

    const result = await processMedia([urls.join(" ")], true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.notice).toContain("Attachment 5: unavailable");
  });
});

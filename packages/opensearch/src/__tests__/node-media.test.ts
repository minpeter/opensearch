import { describe, expect, it } from "vitest";
import { extractMediaMetadata, type YtDlpRunner } from "../node/media.ts";

describe("extractMediaMetadata", () => {
  it("uses yt-dlp JSON output as a Node-only media metadata result", async () => {
    const calls: string[][] = [];
    const runner: YtDlpRunner = (args) => {
      calls.push([...args]);
      return Promise.resolve({
        stdout: JSON.stringify({
          description: "A technical walkthrough.",
          duration: 123,
          extractor: "youtube",
          tags: ["search", "media"],
          title: "Insane Search Demo",
          uploader: "OpenSearch",
          view_count: 42,
          webpage_url: "https://www.youtube.com/watch?v=demo",
        }),
      });
    };

    const result = await extractMediaMetadata("https://youtu.be/demo", {
      runner,
      timeoutMs: 50,
    });

    expect(calls).toEqual([["--dump-json", "https://youtu.be/demo"]]);
    expect(result?.url).toBe("https://www.youtube.com/watch?v=demo");
    expect(result?.content).toContain("- Extractor: youtube");
    expect(result?.content).toContain("A technical walkthrough.");
  });

  it("reports unsupported_dependency when yt-dlp is unavailable", async () => {
    const runner: YtDlpRunner = () =>
      Promise.reject(
        Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" })
      );

    const result = await extractMediaMetadata("https://youtu.be/demo", {
      runner,
    });

    expect(result?.title).toBe("Media metadata unavailable");
    expect(result?.content).toContain("unsupported_dependency");
  });

  it("returns null for non-object yt-dlp JSON", async () => {
    const runner: YtDlpRunner = () => Promise.resolve({ stdout: "[]" });

    await expect(
      extractMediaMetadata("https://example.com/video", { runner })
    ).resolves.toBeNull();
  });
});

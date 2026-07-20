import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ampCacheUrl,
  archiveTodayUrls,
  fetchArchiveFallback,
  waybackAvailabilityUrl,
  waybackCdxUrl,
} from "../fetch/cache-archive.ts";
import { fetchLocalUrl } from "../fetch/local.ts";
import { ARTICLE_HTML, JINA_URL_REGEX } from "./fetch-test-helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cache/archive URL helpers", () => {
  it("constructs AMP cache URLs without Google Cache", () => {
    expect(ampCacheUrl("https://www.example.com/news/a?x=1")).toBe(
      "https://www-example-com.cdn.ampproject.org/c/s/www.example.com/news/a?x=1"
    );
    expect(ampCacheUrl("http://example.com/news/a")).toBe(
      "https://example-com.cdn.ampproject.org/c/example.com/news/a"
    );
  });

  it("rotates archive.today domains", () => {
    expect(archiveTodayUrls("https://example.com/a")).toEqual([
      "https://archive.ph/newest/https://example.com/a",
      "https://archive.is/newest/https://example.com/a",
      "https://archive.md/newest/https://example.com/a",
      "https://archive.vn/newest/https://example.com/a",
      "https://archive.li/newest/https://example.com/a",
    ]);
  });

  it("constructs Wayback availability and CDX URLs", () => {
    expect(waybackAvailabilityUrl("https://example.com/a")).toBe(
      "https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Fa"
    );
    expect(waybackCdxUrl("https://example.com/a")).toContain(
      "https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fexample.com%2Fa"
    );
  });
});

describe("fetchArchiveFallback", () => {
  it("uses Wayback available snapshot after AMP and archive.today miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("amp miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          archived_snapshots: {
            closest: {
              available: true,
              url: "https://web.archive.org/web/20260101000000/https://example.com/a",
            },
          },
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(ARTICLE_HTML));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArchiveFallback("https://example.com/a");

    // biome-ignore lint/suspicious/noUnnecessaryConditions: assertion guard: verifies value is defined before use
    expect(result?.candidate.name).toBe("archive:wayback:available");
    // biome-ignore lint/suspicious/noUnnecessaryConditions: assertion guard: verifies value is defined before use
    expect(result?.candidate.source).toBe("archive");
    expect(result?.response.ok).toBe(true);
  });

  it("uses Wayback CDX when availability has no snapshot", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("amp miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ archived_snapshots: {} }))
      .mockResolvedValueOnce(
        Response.json([
          ["timestamp", "statuscode", "original"],
          ["20260102000000", "200", "https://example.com/a"],
        ])
      )
      .mockResolvedValueOnce(new Response(ARTICLE_HTML));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchArchiveFallback("https://example.com/a");

    // biome-ignore lint/suspicious/noUnnecessaryConditions: assertion guard: verifies value is defined before use
    expect(result?.candidate.name).toBe("archive:wayback:cdx");
    // biome-ignore lint/suspicious/noUnnecessaryConditions: assertion guard: verifies value is defined before use
    expect(result?.candidate.url).toBe(
      "https://web.archive.org/web/20260102000000/https://example.com/a"
    );
  });

  it("returns null when all candidates fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("miss", { status: 503 }))
    );

    await expect(
      fetchArchiveFallback("https://example.com/a")
    ).resolves.toBeNull();
  });

  it("cancels unsuccessful candidate bodies", async () => {
    const cancel = vi.fn();
    const mockFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
          { status: 503 }
        )
      )
    );

    await expect(
      fetchArchiveFallback("https://example.com/a", mockFetch)
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(mockFetch.mock.calls.length);
  });

  it("returns null when dynamic archive discovery is unavailable", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("wayback/available") || url.includes("cdx/search")) {
        return Promise.reject(new Error("archive discovery unavailable"));
      }
      return Promise.resolve(new Response("miss", { status: 503 }));
    });

    await expect(
      fetchArchiveFallback("https://example.com/a", mockFetch)
    ).resolves.toBeNull();
  });
});

describe("local cache/archive fallback", () => {
  it("does not call cache/archive when primary content succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(ARTICLE_HTML)));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchLocalUrl("https://example.com/article");

    const calledUrls = mockFetch.mock.calls.map(([input]) => String(input));
    expect(calledUrls.some((url) => url.includes("archive."))).toBe(false);
    expect(calledUrls.some((url) => url.includes("ampproject.org"))).toBe(
      false
    );
    expect(result.content).toContain("Test Heading");
  });

  it("adopts a Wayback sidecar after primary paths fail", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("reader miss", { status: 500 }))
      .mockResolvedValueOnce(new Response("amp miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(new Response("archive miss", { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          archived_snapshots: {
            closest: {
              available: true,
              url: "https://web.archive.org/web/20260101000000/https://example.com/a",
            },
          },
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(ARTICLE_HTML));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchLocalUrl("https://docs.example.com/a");

    expect(String(mockFetch.mock.calls[1]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.url).toBe("https://docs.example.com/a");
    expect(result.content).toContain("Test Heading");
  });

  it("keeps the anti-bot error when cache/archive candidates fail", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("reader miss", { status: 500 }))
      .mockResolvedValue(new Response("miss", { status: 503 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchLocalUrl("https://docs.example.com/missing")
    ).rejects.toThrow("anti-bot challenge");
  });
});

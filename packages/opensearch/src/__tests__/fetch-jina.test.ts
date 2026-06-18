import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJinaReader } from "../fetch/jina.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchJinaReader", () => {
  it("returns text reader content", async () => {
    const content = "Readable Jina markdown content that is useful.";
    const mockFetch = vi.fn().mockResolvedValue(new Response(content));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchJinaReader("https://example.com/article");

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://r.jina.ai/https://example.com/article"
    );
    expect(result?.content).toBe(content);
    expect(result?.mode).toBe("text");
  });

  it("extracts JSON content and alternate feed hints", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          content: "Structured markdown content",
          external: {
            alternate: [
              "https://example.com/feed.xml",
              "https://example.com/atom.xml",
            ],
          },
          title: "Structured title",
          url: "https://example.com/canonical",
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchJinaReader("https://example.com/article", {
      mode: "json",
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Accept).toBe("application/json");
    expect(result?.title).toBe("Structured title");
    expect(result?.url).toBe("https://example.com/canonical");
    expect(result?.alternates).toEqual([
      "https://example.com/feed.xml",
      "https://example.com/atom.xml",
    ]);
  });

  it("sets advanced reader headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await fetchJinaReader("https://example.com/article", {
      cacheToleranceSeconds: 600,
      cookies: "session=abc",
      mode: "html",
      noCache: true,
      targetSelector: ".article-body",
      withLinks: true,
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-Respond-With"]).toBe("html");
    expect(headers["X-Target-Selector"]).toBe(".article-body");
    expect(headers["X-No-Cache"]).toBe("true");
    expect(headers["X-Cache-Tolerance"]).toBe("600");
    expect(headers["X-With-Links"]).toBe("true");
    expect(headers["X-Set-Cookie"]).toBe("session=abc");
  });

  it("supports SSE accept headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("event: done"));
    vi.stubGlobal("fetch", mockFetch);

    await fetchJinaReader("https://example.com/spa", { mode: "sse" });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("returns null for non-ok, empty, or challenge content", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(
        new Response("Just a moment... Checking your browser")
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchJinaReader("https://example.com/a")).resolves.toBeNull();
    await expect(fetchJinaReader("https://example.com/b")).resolves.toBeNull();
    await expect(fetchJinaReader("https://example.com/c")).resolves.toBeNull();
  });
});

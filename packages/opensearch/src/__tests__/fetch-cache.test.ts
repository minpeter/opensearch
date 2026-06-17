import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("unpdf", () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

const { fetchExaMcp, fetchExaMcpBatch } = vi.hoisted(() => ({
  fetchExaMcp: vi.fn(),
  fetchExaMcpBatch: vi.fn(),
}));

vi.mock("../providers/exa-mcp/client.ts", () => ({
  fetchExaMcp,
  fetchExaMcpBatch,
}));

import { fetchUrlsWithCache, fetchUrlWithCache } from "./full-runtime.ts";

beforeEach(() => {
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
  process.env.OPENSEARCH_ENABLE_FIRECRAWL = "false";
  delete process.env.EXA_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  fetchExaMcp.mockReset();
  fetchExaMcp.mockRejectedValue(new Error("Exa MCP unavailable"));
  fetchExaMcpBatch.mockReset();
  fetchExaMcpBatch.mockRejectedValue(new Error("Exa MCP unavailable"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchUrlWithCache", () => {
  it("caches result and returns it on second call", async () => {
    const html = `<!DOCTYPE html><html><head><title>Cache Test</title></head>
    <body><article><h1>Cache Test</h1>
    <p>Testing that the cache works properly with multiple calls.</p>
    <p>This is more content to make Readability happy and extract the article.</p>
    <p>Yet another paragraph for good measure.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlWithCache("https://example.com/cached");
    await fetchUrlWithCache("https://example.com/cached");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expiry", async () => {
    const html = `<!DOCTYPE html><html><head><title>TTL Test</title></head>
    <body><article><h1>TTL Test</h1>
    <p>Testing that the TTL cache expires properly.</p>
    <p>More content to ensure Readability works correctly here.</p>
    <p>Final paragraph for the article body.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlWithCache("https://example.com/ttl-test");
    vi.advanceTimersByTime(4 * 60 * 1000);
    await fetchUrlWithCache("https://example.com/ttl-test");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("reuses cached results after batched fetch warmup when maxCharacters is omitted", async () => {
    fetchExaMcpBatch.mockRejectedValueOnce(new Error("Exa timeout"));
    const html = `<!DOCTYPE html><html><head><title>Batch Cache Test</title></head>
    <body><article><h1>Batch Cache Test</h1>
    <p>Testing that batched fetches populate per-url cache entries.</p>
    <p>More content to ensure Readability extracts the article body.</p>
    <p>Final paragraph for good measure.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlsWithCache(["https://example.com/cached-batch"]);
    await fetchUrlWithCache("https://example.com/cached-batch");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

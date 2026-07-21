import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processEnvironmentReader } from "../environment.ts";
import { createSearchService } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

// These tests pin single-pass provider behavior, so they use the uncached
// single-attempt path rather than the retrying, caching module-level search().
const { search } = createSearchService(processEnvironmentReader);

describe("TinyFish search provider", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("uses TinyFish before credential-backed raw API providers when configured", async () => {
    process.env.TINYFISH_API_KEY = " tinyfish-key ";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        page: 0,
        query: "tinyfish docs",
        results: [
          {
            position: 1,
            site_name: "docs.tinyfish.ai",
            snippet: "TinyFish docs snippet",
            title: "TinyFish Docs",
            url: "https://docs.tinyfish.ai/",
          },
        ],
        total_results: 1,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("tinyfish docs", 3);

    expect(results).toEqual([
      {
        engine: "TinyFish",
        snippet: "TinyFish docs snippet",
        title: "TinyFish Docs",
        url: "https://docs.tinyfish.ai/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.origin).toBe("https://api.search.tinyfish.ai");
    expect(parsedUrl.searchParams.get("query")).toBe("tinyfish docs");
    expect(parsedUrl.searchParams.get("location")).toBe("US");
    expect(parsedUrl.searchParams.get("language")).toBe("en");
    expect(parsedUrl.searchParams.get("page")).toBe("0");
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "tinyfish-key" }),
        method: "GET",
      })
    );
  });

  it("limits TinyFish search results to the requested count", async () => {
    process.env.TINYFISH_API_KEY = "tinyfish-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            snippet: "First result.",
            title: "First",
            url: "https://example.com/first",
          },
          {
            snippet: "Second result.",
            title: "Second",
            url: "https://example.com/second",
          },
          {
            snippet: "Third result.",
            title: "Third",
            url: "https://example.com/third",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("tinyfish docs", 2);

    expect(results).toEqual([
      {
        engine: "TinyFish",
        snippet: "First result.",
        title: "First",
        url: "https://example.com/first",
      },
      {
        engine: "TinyFish",
        snippet: "Second result.",
        title: "Second",
        url: "https://example.com/second",
      },
    ]);
  });

  it("retries TinyFish search only on 429 with the next configured key", async () => {
    process.env.TINYFISH_API_KEY = "tf-search-1; ;tf-search-2";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: { message: "rate limited" } }, 429)
      )
      .mockResolvedValueOnce(
        createMockJsonResponse({
          page: 0,
          query: "tinyfish docs",
          results: [
            {
              position: 1,
              site_name: "docs.tinyfish.ai",
              snippet: "Recovered with the second TinyFish key.",
              title: "TinyFish Docs",
              url: "https://docs.tinyfish.ai/",
            },
          ],
          total_results: 1,
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("tinyfish docs");

    expect(results[0]?.engine).toBe("TinyFish");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "X-API-Key": "tf-search-1" }),
      expect.objectContaining({ "X-API-Key": "tf-search-2" }),
    ]);
  });

  it("falls back when TinyFish search returns malformed fields", async () => {
    process.env.TINYFISH_API_KEY = "tinyfish-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({
          page: 0,
          query: "tinyfish docs",
          results: [
            {
              position: 1,
              site_name: "docs.tinyfish.ai",
              snippet: "Missing title should fail strict parsing.",
              url: "https://docs.tinyfish.ai/",
            },
          ],
          total_results: 1,
        })
      )
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa fallback after malformed TinyFish."],
              title: "Exa fallback",
              url: "https://example.com/exa-fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("tinyfish docs");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Exa fallback after malformed TinyFish.",
        title: "Exa fallback",
        url: "https://example.com/exa-fallback",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

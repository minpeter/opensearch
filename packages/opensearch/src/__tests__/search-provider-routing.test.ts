import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_ENGINE_NAMES, search } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

function getRequestBody(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const init = mockFetch.mock.calls[0]?.[1];
  const body = init?.body;

  return typeof body === "string" ? JSON.parse(body) : undefined;
}

describe("search provider routing", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("advertises every optional provider supported by the routing registry", () => {
    expect(SEARCH_ENGINE_NAMES).toEqual(
      expect.arrayContaining([
        "Brave",
        "BrightData",
        "DataForSEO",
        "DuckDuckGo",
        "Exa",
        "Firecrawl",
        "Google",
        "Jina",
        "Kagi",
        "Linkup",
        "Mojeek",
        "Parallel",
        "Perplexity",
        "ScrapingBee",
        "SearchAPI",
        "SearxNG",
        "SerpAPI",
        "Serper",
        "Tavily",
        "TinyFish",
        "Valyu",
        "You",
      ])
    );
    expect(SEARCH_ENGINE_NAMES).not.toEqual(
      expect.arrayContaining(["Bing", "Startpage", "Webcrawler"])
    );
  });

  it("routes configured LLM-native providers before raw API providers", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Tavily returns agent-ready search results.",
            title: "Tavily Search",
            url: "https://docs.tavily.com/",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("agent search", 2);

    expect(results).toEqual([
      {
        engine: "Tavily",
        snippet: "Tavily returns agent-ready search results.",
        title: "Tavily Search",
        url: "https://docs.tavily.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tavily-key",
        }),
        method: "POST",
      })
    );
  });

  it("ignores retired Naver credentials for Korean queries", async () => {
    process.env.NAVER_CLIENT_ID = "naver-client";
    process.env.NAVER_CLIENT_SECRET = "naver-secret";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Tavily handles Korean queries without Naver routing.",
            title: "Korean query result",
            url: "https://example.com/korean-query",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("서울 맛집 추천", 1);

    expect(results).toEqual([
      {
        engine: "Tavily",
        snippet: "Tavily handles Korean queries without Naver routing.",
        title: "Korean query result",
        url: "https://example.com/korean-query",
      },
    ]);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tavily-key",
        }),
        method: "POST",
      })
    );
  });

  it("falls through malformed configured providers to the next clean provider", async () => {
    process.env.SERPER_API_KEY = "serper-key";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ unexpected: true }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          organic: [
            {
              link: "https://serper.dev/",
              snippet: "Serper recovered after Tavily returned a bad shape.",
              title: "Serper",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("fallback routing", 3);

    expect(results).toEqual([
      {
        engine: "Serper",
        snippet: "Serper recovered after Tavily returned a bad shape.",
        title: "Serper",
        url: "https://serper.dev/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses configured SearxNG before DuckDuckGo when no tokens are configured", async () => {
    process.env.OPENSEARCH_SEARXNG_URLS = "https://searx.example";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "A public SearxNG result before scrape fallback.",
            title: "SearxNG result",
            url: "https://example.com/searxng",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("zero config search", 1);

    expect(results).toEqual([
      {
        engine: "SearxNG",
        snippet: "A public SearxNG result before scrape fallback.",
        title: "SearxNG result",
        url: "https://example.com/searxng",
      },
    ]);
    const searxUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(`${searxUrl.origin}${searxUrl.pathname}`).toBe(
      "https://searx.example/search"
    );
    expect(searxUrl.searchParams.get("q")).toBe("zero config search");
  });

  it("routes zero-config search through Firecrawl before DuckDuckGo", async () => {
    process.env.OPENSEARCH_ENABLE_FIRECRAWL = "true";
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        data: {
          web: [
            {
              description: "Firecrawl no-key search result.",
              title: "Firecrawl Search",
              url: "https://www.firecrawl.dev/",
            },
          ],
        },
        success: true,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("firecrawl no key", 1);

    expect(results).toEqual([
      {
        engine: "Firecrawl",
        snippet: "Firecrawl no-key search result.",
        title: "Firecrawl Search",
        url: "https://www.firecrawl.dev/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
        method: "POST",
      })
    );
    expect(getRequestBody(mockFetch)).toEqual({
      limit: 1,
      query: "firecrawl no key",
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        parsers: ["pdf"],
        removeBase64Images: true,
      },
      sources: ["web"],
    });
  });
});

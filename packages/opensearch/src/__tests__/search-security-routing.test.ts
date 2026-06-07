import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSearchText } from "../search/http.ts";
import { search } from "../search.ts";
import {
  createMockJsonResponse,
  createMockResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("search provider security guardrails", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("does not send credential headers to non-HTTPS endpoint overrides", async () => {
    process.env.OPENSEARCH_SEARXNG_URLS = "https://searx.example";
    process.env.OPENSEARCH_TAVILY_URL = "http://evil.example/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Safe fallback result.",
            title: "SearxNG fallback",
            url: "https://example.com/safe",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("override guard", 1);

    expect(results[0]).toEqual({
      engine: "SearxNG",
      snippet: "Safe fallback result.",
      title: "SearxNG fallback",
      url: "https://example.com/safe",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("https://searx.example/search");
    expect(requestedUrls.join("\n")).not.toContain("evil.example");
  });

  it("does not fetch non-local HTTP SearxNG endpoint overrides", async () => {
    process.env.OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS = "true";
    process.env.OPENSEARCH_SEARXNG_URLS = "http://evil.example";
    process.env.OPENSEARCH_STARTPAGE_URL = "http://localhost/startpage";

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      if (String(url).includes("evil.example")) {
        return Promise.resolve(
          createMockJsonResponse({
            results: [
              {
                content: "Untrusted SearxNG result.",
                title: "Untrusted SearxNG",
                url: "https://example.com/untrusted",
              },
            ],
          })
        );
      }

      return Promise.resolve(
        createMockResponse(`
          <div class="result">
            <a class="result-title" href="https://example.com/trusted">
              Trusted fallback
            </a>
            <p class="description">Trusted fallback result.</p>
          </div>
        `)
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("searxng override guard", 1);

    expect(results[0]).toEqual({
      engine: "Startpage",
      snippet: "Trusted fallback result.",
      title: "Trusted fallback",
      url: "https://example.com/trusted",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("http://localhost/startpage");
    expect(requestedUrls.join("\n")).not.toContain("evil.example");
  });

  it("falls through invalid zero-key HTML endpoint overrides", async () => {
    process.env.OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS = "true";
    process.env.OPENSEARCH_STARTPAGE_URL = "http://evil.example/startpage";
    process.env.OPENSEARCH_WEBCRAWLER_URL = "http://evil.example/webcrawler";
    process.env.OPENSEARCH_INTERNET_ARCHIVE_URL = "http://localhost/archive";
    process.env.OPENSEARCH_WIBY_URL = "http://localhost/wiby";
    process.env.OPENSEARCH_WIKIPEDIA_URL = "http://localhost/wikipedia";

    const mockFetch = vi.fn((url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("html.duckduckgo.com")) {
        return Promise.resolve(
          createMockResponse('<div class="no-results" />')
        );
      }
      if (requestUrl.includes("bing.com/search")) {
        return Promise.resolve(createMockResponse('<div class="b_no" />'));
      }
      if (requestUrl.includes("localhost/archive")) {
        return Promise.resolve(
          createMockJsonResponse({ response: { docs: [] } })
        );
      }
      if (requestUrl.includes("localhost/wiby")) {
        return Promise.resolve(createMockResponse("<html></html>"));
      }
      if (!requestUrl.includes("localhost/wikipedia")) {
        return Promise.resolve(createMockResponse("<html></html>"));
      }

      return Promise.resolve(
        createMockJsonResponse({
          query: {
            search: [
              {
                pageid: 123,
                snippet: "Trusted Wikipedia fallback.",
                title: "Trusted fallback",
              },
            ],
          },
        })
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("zero-key override guard", 1);

    expect(results[0]).toEqual({
      engine: "Wikipedia",
      snippet: "Trusted Wikipedia fallback.",
      title: "Trusted fallback",
      url: "https://en.wikipedia.org/?curid=123",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://html.duckduckgo.com/html/"),
        expect.stringContaining("https://www.bing.com/search"),
        expect.stringContaining("http://localhost/wikipedia"),
        expect.stringContaining("http://localhost/archive"),
        expect.stringContaining("http://localhost/wiby"),
      ])
    );
    expect(requestedUrls.join("\n")).not.toContain("evil.example");
  });

  it("allows local HTTP endpoint overrides for tests and private gateways", async () => {
    process.env.OPENSEARCH_TAVILY_URL = "http://127.0.0.1:43111/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Local override result.",
            title: "Local Tavily",
            url: "https://example.com/local",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("local override", 1);

    expect(results[0]?.engine).toBe("Tavily");
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "http://127.0.0.1:43111/search"
    );
  });

  it("allows IPv6 localhost HTTP endpoint overrides", async () => {
    process.env.OPENSEARCH_TAVILY_URL = "http://[::1]:43111/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "IPv6 local override result.",
            title: "IPv6 Tavily",
            url: "https://example.com/ipv6-local",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("ipv6 local override", 1);

    expect(results[0]?.engine).toBe("Tavily");
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "http://[::1]:43111/search"
    );
  });

  it("does not automatically follow provider redirects with auth headers", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchSearchText({
      engine: "Tavily",
      init: {
        headers: { "X-API-Key": "secret" },
        method: "GET",
      },
      url: "https://api.tavily.com/search",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ redirect: "manual" })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenSearch, fetch, search } from "../index.ts";
import {
  createOpenSearch as createNodeOpenSearch,
  fetchResultSchema,
  fetch as nodeFetch,
  search as nodeSearch,
  SEARCH_ENGINE_NAMES,
  SearchEngineError,
  SearchExecutionError,
  searchResultSchema,
} from "../node.ts";
import {
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("public API", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("exports stable search and fetch schemas for library consumers", async () => {
    const rootApi = await import("../index.ts");
    const nodeApi = await import("../node.ts");
    const parsedSearchResult = searchResultSchema.parse({
      engine: "DuckDuckGo",
      snippet: "Typed JavaScript at scale.",
      title: "TypeScript",
      url: "https://www.typescriptlang.org/",
    });
    const parsedFetchResult = fetchResultSchema.parse({
      content: "# Example",
      length: 9,
      title: "Example",
      url: "https://example.com",
    });

    expect(SEARCH_ENGINE_NAMES).toContain("DuckDuckGo");
    expect(SEARCH_ENGINE_NAMES).not.toContain("Bing");
    expect(typeof createOpenSearch).toBe("function");
    expect(typeof createNodeOpenSearch).toBe("function");
    expect(typeof fetch).toBe("function");
    expect(typeof nodeFetch).toBe("function");
    expect(typeof search).toBe("function");
    expect(typeof nodeSearch).toBe("function");
    expect(parsedSearchResult.engine).toBe("DuckDuckGo");
    expect(parsedFetchResult.length).toBe(9);
    expect(rootApi).not.toHaveProperty("fetchUrl");
    expect(rootApi).not.toHaveProperty("fetchUrls");
    expect(rootApi).not.toHaveProperty("fetchUrlsWithCache");
    expect(rootApi).not.toHaveProperty("searchOnce");
    expect(rootApi).not.toHaveProperty("searchWithRetryAndCache");
    expect(nodeApi).not.toHaveProperty("fetchUrl");
    expect(nodeApi).not.toHaveProperty("fetchUrls");
    expect(nodeApi).not.toHaveProperty("fetchUrlsWithCache");
    expect(nodeApi).not.toHaveProperty("searchOnce");
    expect(nodeApi).not.toHaveProperty("searchWithRetryAndCache");
  });

  it("keeps fetch result schema at the public result shape", () => {
    const parsedFetchResult = fetchResultSchema.parse({
      content: "# Hacker News\nReadable content.",
      length: 31,
      title: "Hacker News",
      url: "https://news.ycombinator.com/item?id=1",
    });

    expect(parsedFetchResult).toEqual({
      content: "# Hacker News\nReadable content.",
      length: 31,
      title: "Hacker News",
      url: "https://news.ycombinator.com/item?id=1",
    });
  });

  it("exports typed search errors for library consumers", () => {
    const executionError = new SearchExecutionError("No Results", false);
    const engineError = new SearchEngineError(
      "DuckDuckGo",
      "blocked",
      "Blocked"
    );

    expect(executionError.retryable).toBe(false);
    expect(engineError.engine).toBe("DuckDuckGo");
    expect(engineError.kind).toBe("blocked");
  });

  it("exports concise search as the cached default for library consumers", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          createMockResponse(readFixture("duckduckgo-github.html"))
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const firstResults = await nodeSearch("public-api-search");
    const secondResults = await nodeSearch("public-api-search");

    expect(firstResults).toEqual(secondResults);
    expect(firstResults[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("exports concise fetch for batches and single URLs", async () => {
    const articleUrl = "https://example.com/public-fetch";
    const html = `<!DOCTYPE html><html><head><title>QA Article</title></head>
      <body><article><h1>QA Article</h1>
      <p>Readable content for the concise public fetch API.</p>
      <p>Second paragraph to satisfy article extraction.</p>
      <p>Final paragraph for stable readability output.</p></article></body></html>`;
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const batchResults = await nodeFetch([articleUrl]);
    const singleResult = await nodeFetch(articleUrl);

    expect(batchResults).toHaveLength(1);
    expect(batchResults[0]?.title).toBe("QA Article");
    expect(batchResults[0]?.content).toContain("concise public fetch API");
    expect(singleResult.title).toBe("QA Article");
    expect(singleResult.content).toContain("concise public fetch API");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

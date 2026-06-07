import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearch,
  fetch,
  fetchResultSchema,
  SEARCH_ENGINE_NAMES,
  SearchEngineError,
  SearchExecutionError,
  search,
  searchResultSchema,
} from "../index.ts";
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
    const publicApi = await import("../index.ts");
    const parsedSearchResult = searchResultSchema.parse({
      engine: "Bing",
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

    expect(SEARCH_ENGINE_NAMES).toContain("Bing");
    expect(typeof createOpenSearch).toBe("function");
    expect(parsedSearchResult.engine).toBe("Bing");
    expect(parsedFetchResult.length).toBe(9);
    expect(publicApi).not.toHaveProperty("fetchUrl");
    expect(publicApi).not.toHaveProperty("fetchUrls");
    expect(publicApi).not.toHaveProperty("fetchUrlsWithCache");
    expect(publicApi).not.toHaveProperty("searchOnce");
    expect(publicApi).not.toHaveProperty("searchWithRetryAndCache");
  });

  it("exports typed search errors for library consumers", () => {
    const executionError = new SearchExecutionError("No Results", false);
    const engineError = new SearchEngineError("Bing", "blocked", "Blocked");

    expect(executionError.retryable).toBe(false);
    expect(engineError.engine).toBe("Bing");
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

    const firstResults = await search("public-api-search");
    const secondResults = await search("public-api-search");

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

    const batchResults = await fetch([articleUrl]);
    const singleResult = await fetch(articleUrl);

    expect(batchResults).toHaveLength(1);
    expect(batchResults[0]?.title).toBe("QA Article");
    expect(batchResults[0]?.content).toContain("concise public fetch API");
    expect(singleResult.title).toBe("QA Article");
    expect(singleResult.content).toContain("concise public fetch API");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

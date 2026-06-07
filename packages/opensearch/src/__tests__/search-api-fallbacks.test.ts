import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockJsonResponse,
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("API provider fallback semantics", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("falls back from Brave empty results to Exa", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({
          web: {
            results: [],
          },
        })
      )
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa fallback result."],
              title: "Exa fallback",
              url: "https://example.com/exa-fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("fallback-test");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Exa fallback result.",
        title: "Exa fallback",
        url: "https://example.com/exa-fallback",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back from Exa empty results to DuckDuckGo", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [],
        })
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("fallback-test");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces unexpected Brave payloads instead of masking them as no-results", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ notWeb: true }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: Brave, DuckDuckGo, Bing [Brave:transient; DuckDuckGo:no-results; Bing:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("surfaces unexpected Exa payloads instead of masking them as no-results", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ notResults: true }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: Exa, DuckDuckGo, Bing [Exa:transient; DuckDuckGo:no-results; Bing:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

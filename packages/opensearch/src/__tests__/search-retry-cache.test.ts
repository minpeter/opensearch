import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { searchWithRetryAndCache } from "../search.ts";
import {
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("searchWithRetryAndCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetSearchEnv();
  });

  it("retries on transient errors", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const resultPromise = searchWithRetryAndCache("github-retry", 5);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  }, 30_000);

  it("does NOT retry on No Results after the full fallback chain", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("nothing", 5)).rejects.toThrow(
      "No Results"
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses the fallback chain and caches the final successful result", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const firstResults = await searchWithRetryAndCache(
      "github-cached-fallback",
      10
    );
    const secondResults = await searchWithRetryAndCache(
      "github-cached-fallback",
      10
    );

    expect(firstResults).toEqual(secondResults);
    expect(firstResults[0]?.engine).toBe("Bing");
    expect(firstResults[0]?.title).toBe("GitHub");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when mixed failures produce the terminal aggregated error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockRejectedValueOnce(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("mixed-failure", 5)).rejects.toThrow(
      "Search failed across all engines: DuckDuckGo, Bing [DuckDuckGo:blocked; Bing:transient]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when Exa rejects the request with payment/auth failure", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 402 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      searchWithRetryAndCache("exa-auth-failure", 5)
    ).rejects.toThrow(
      "Search failed across all engines: Exa, DuckDuckGo, Bing [Exa:misconfigured; DuckDuckGo:blocked; Bing:blocked]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("re-fetches after TTL expiry", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          createMockResponse(readFixture("duckduckgo-github.html"))
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    await searchWithRetryAndCache("github-ttl", 10);
    vi.advanceTimersByTime(4 * 60 * 1000);
    await searchWithRetryAndCache("github-ttl", 10);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("slices results to max_results", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          createMockResponse(readFixture("duckduckgo-github.html"))
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await searchWithRetryAndCache("github-slice", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

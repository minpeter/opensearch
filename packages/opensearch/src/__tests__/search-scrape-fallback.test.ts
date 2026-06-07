import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("scrape search fallback", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("limits scrape provider results to the requested count", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github", 3);

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.engine === "DuckDuckGo")).toBe(
      true
    );
  });

  it("falls back to DuckDuckGo scrape when API providers are unavailable", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://html.duckduckgo.com/html/",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to Bing when DuckDuckGo scrape is bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      engine: "Bing",
      snippet:
        "GitHub is the leading platform for software collaboration and version control.",
      title: "GitHub",
      url: "https://github.com/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws a meaningful error when all enabled engines fail or are bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: DuckDuckGo, Bing [DuckDuckGo:blocked; Bing:blocked]"
    );
  });

  it("throws No Results when all enabled engines explicitly return no-results", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("noresultsquery")).rejects.toThrow("No Results");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

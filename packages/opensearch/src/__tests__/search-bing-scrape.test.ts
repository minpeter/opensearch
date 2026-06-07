import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("Bing scrape fallback", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("uses heuristic extraction when Bing selectors miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-heuristic.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("beta");

    expect(results).toEqual([
      {
        engine: "Bing",
        snippet:
          "includes enough nearby body text to become a cleaned snippet even when standard selectors are absent.",
        title: "Example Beta",
        url: "https://example.org/beta",
      },
    ]);
  });

  it("normalizes Bing wrapper URLs to final targets", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-wrapper.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("wrapped-result");

    expect(results).toEqual([
      {
        engine: "Bing",
        snippet: "Bing wrapper URLs should decode to final usable targets.",
        title: "Example Wrapped Result",
        url: "https://example.net/path?x=1",
      },
    ]);
  });
});

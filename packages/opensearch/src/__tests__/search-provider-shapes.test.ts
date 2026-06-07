import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("provider-specific request and response shapes", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("parses Parallel excerpts as result snippets", async () => {
    process.env.PARALLEL_API_KEY = "parallel-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            excerpts: ["First excerpt.", "Second excerpt."],
            title: "Parallel result",
            url: "https://example.com/parallel",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("parallel shape", 2);

    expect(results[0]).toEqual({
      engine: "Parallel",
      snippet: "First excerpt. Second excerpt.",
      title: "Parallel result",
      url: "https://example.com/parallel",
    });
    const [, init] = mockFetch.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      max_chars_total: 2400,
      objective: "parallel shape",
      search_queries: ["parallel shape"],
    });
  });

  it("keeps common provider results when optional titles are null", async () => {
    process.env.PARALLEL_API_KEY = "parallel-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            excerpts: ["Parallel result without a title."],
            title: null,
            url: "https://example.com/parallel-null-title",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("parallel nullable title", 1);

    expect(results[0]).toEqual({
      engine: "Parallel",
      snippet: "Parallel result without a title.",
      title: "https://example.com/parallel-null-title",
      url: "https://example.com/parallel-null-title",
    });
  });

  it("uses Valyu v1 search request fields", async () => {
    process.env.VALYU_API_KEY = "valyu-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Valyu result content.",
            title: "Valyu result",
            url: "https://example.com/valyu",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("valyu shape", 4);

    expect(results[0]?.engine).toBe("Valyu");
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.valyu.ai/v1/search");
    expect(JSON.parse(String(init?.body))).toEqual({
      max_num_results: 4,
      query: "valyu shape",
    });
    expect(init?.headers).toEqual(
      expect.objectContaining({ "X-API-Key": "valyu-key" })
    );
  });

  it("uses Bright Data request endpoint only when a SERP zone is configured", async () => {
    process.env.BRIGHT_DATA_SERP_API_KEY = "bright-data-key";
    process.env.BRIGHT_DATA_SERP_ZONE = "serp-zone";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        organic: [
          {
            snippet: "Bright Data result.",
            title: "Bright Data",
            url: "https://example.com/bright-data",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("bright data shape", 3);

    expect(results[0]?.engine).toBe("BrightData");
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.brightdata.com/request");
    const body = JSON.parse(String(init?.body));
    expect(body.zone).toBe("serp-zone");
    expect(body.format).toBe("json");
    expect(body.url).toContain("https://www.google.com/search?");
    expect(body.url).toContain("q=bright+data+shape");
  });
});

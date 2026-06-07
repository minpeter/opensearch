import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

function getRequestBody(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const init = mockFetch.mock.calls[0]?.[1];
  const body = init?.body;

  return typeof body === "string" ? JSON.parse(body) : undefined;
}

describe("official provider API contracts", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("uses Parallel v1 search and parses excerpt results", async () => {
    process.env.PARALLEL_API_KEY = "parallel-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            excerpts: ["Parallel excerpt one.", "Parallel excerpt two."],
            title: "Parallel result",
            url: "https://example.com/parallel",
          },
        ],
        search_id: "search_123",
        session_id: "session_123",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("parallel current api", 2);

    expect(results).toEqual([
      {
        engine: "Parallel",
        snippet: "Parallel excerpt one. Parallel excerpt two.",
        title: "Parallel result",
        url: "https://example.com/parallel",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.parallel.ai/v1/search",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "parallel-key" }),
        method: "POST",
        redirect: "manual",
      })
    );
    expect(getRequestBody(mockFetch)).toEqual({
      max_chars_total: 2400,
      objective: "parallel current api",
      search_queries: ["parallel current api"],
    });
  });

  it("uses Valyu v1 search request fields", async () => {
    process.env.VALYU_API_KEY = "valyu-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Valyu current response content.",
            title: "Valyu result",
            url: "https://example.com/valyu",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("valyu current api", 3);

    expect(results[0]).toEqual({
      engine: "Valyu",
      snippet: "Valyu current response content.",
      title: "Valyu result",
      url: "https://example.com/valyu",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.valyu.ai/v1/search",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "valyu-key" }),
        method: "POST",
      })
    );
    expect(getRequestBody(mockFetch)).toEqual({
      max_num_results: 3,
      query: "valyu current api",
    });
  });

  it("uses Bright Data request endpoint with zone and target SERP URL", async () => {
    process.env.BRIGHT_DATA_SERP_API_KEY = "bright-key";
    process.env.BRIGHT_DATA_SERP_ZONE = "serp-zone";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        organic: [
          {
            description: "Bright Data organic result.",
            link: "https://example.com/bright",
            title: "Bright Data result",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("bright data api", 4);

    expect(results[0]).toEqual({
      engine: "BrightData",
      snippet: "Bright Data organic result.",
      title: "Bright Data result",
      url: "https://example.com/bright",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.brightdata.com/request",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bright-key",
        }),
        method: "POST",
      })
    );
    const body = getRequestBody(mockFetch);

    expect(body).toEqual({
      format: "json",
      method: "GET",
      url: expect.stringContaining("https://www.google.com/search?num=4"),
      zone: "serp-zone",
    });
    expect(body).toEqual(
      expect.objectContaining({
        url: expect.stringContaining("q=bright+data+api"),
      })
    );
  });
});

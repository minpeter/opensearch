import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockJsonResponse,
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

const searchParallelMcp = vi.fn();

vi.mock("../parallel-mcp.ts", () => ({
  searchParallelMcp,
}));

function resetEnv(): void {
  resetSearchEnv();
  process.env.OPENSEARCH_ENABLE_PARALLEL_MCP = "true";
}

describe("search with Parallel MCP", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEnv();
  });

  it("uses anonymous Parallel MCP before public meta-search and scrape fallback", async () => {
    process.env.OPENSEARCH_SEARXNG_URLS = "https://searx.example";
    searchParallelMcp.mockResolvedValueOnce([
      {
        snippet: "Hosted MCP result.",
        title: "Parallel MCP",
        url: "https://example.com/parallel-mcp",
      },
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("agent search", 2);

    expect(results).toEqual([
      {
        engine: "Parallel",
        snippet: "Hosted MCP result.",
        title: "Parallel MCP",
        url: "https://example.com/parallel-mcp",
      },
    ]);
    expect(searchParallelMcp).toHaveBeenCalledWith("agent search");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls through to later providers when Parallel MCP fails", async () => {
    process.env.OPENSEARCH_SEARXNG_URLS = "https://searx.example";
    searchParallelMcp.mockRejectedValueOnce(new Error("mcp timeout"));
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "SearxNG recovered after MCP failure.",
            title: "SearxNG result",
            url: "https://example.com/searx",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("fallback search", 1);

    expect(results[0]).toEqual({
      engine: "SearxNG",
      snippet: "SearxNG recovered after MCP failure.",
      title: "SearxNG result",
      url: "https://example.com/searx",
    });
    expect(searchParallelMcp).toHaveBeenCalledWith("fallback search");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("skips Parallel MCP when OPENSEARCH_ENABLE_PARALLEL_MCP is false", async () => {
    process.env.OPENSEARCH_ENABLE_PARALLEL_MCP = "false";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github", 1);

    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(searchParallelMcp).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockJsonResponse,
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

const searchExaMcp = vi.fn();

vi.mock("../exa-mcp.ts", () => ({
  searchExaMcp,
}));

function resetEnv(): void {
  resetSearchEnv();
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
}

describe("search with Exa MCP", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEnv();
  });

  it("uses Exa MCP before scrape providers when raw Exa credentials are absent", async () => {
    searchExaMcp.mockResolvedValueOnce([
      {
        snippet: "Official GitHub homepage.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Official GitHub homepage.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
    expect(searchExaMcp).toHaveBeenCalledWith("github", 10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls through to scrape providers when Exa MCP fails", async () => {
    searchExaMcp.mockRejectedValueOnce(new Error("mcp temporary failure"));
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github");

    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(searchExaMcp).toHaveBeenCalledWith("github", 10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps hosted Exa MCP ahead of the raw Exa API when EXA_API_KEY is configured", async () => {
    process.env.EXA_API_KEY = "exa-key";
    searchExaMcp.mockResolvedValueOnce([
      {
        snippet: "Hosted MCP result.",
        title: "Exa MCP",
        url: "https://example.com/exa-mcp",
      },
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Hosted MCP result.",
        title: "Exa MCP",
        url: "https://example.com/exa-mcp",
      },
    ]);
    expect(searchExaMcp).toHaveBeenCalledWith("github", 10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the raw Exa API when hosted Exa MCP fails and EXA_API_KEY is configured", async () => {
    process.env.EXA_API_KEY = "exa-key";
    searchExaMcp.mockRejectedValueOnce(new Error("mcp temporary failure"));
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            highlights: ["Raw API result."],
            title: "Exa API",
            url: "https://example.com/exa-api",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Raw API result.",
        title: "Exa API",
        url: "https://example.com/exa-api",
      },
    ]);
    expect(searchExaMcp).toHaveBeenCalledWith("github", 10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "exa-key",
        }),
        method: "POST",
      })
    );
  });

  it("skips Exa MCP when OPENSEARCH_ENABLE_EXA_MCP is false", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", fetchSpy);

    const { search } = await import("../search.ts");
    const results = await search("github");

    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(searchExaMcp).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

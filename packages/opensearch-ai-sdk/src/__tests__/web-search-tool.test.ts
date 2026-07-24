import {
  SEARCH_ENGINE_NAMES,
  type SearchResult,
  searchResultsSchema,
} from "@minpeter/opensearch";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../index.ts";
import { webSearchOutputSchema } from "../tool-schemas.ts";

const toolExecutionOptions: ToolExecutionOptions<unknown> = {
  context: undefined,
  messages: [],
  toolCallId: "tool-call-test",
};

const searchResult: SearchResult = {
  engine: "DuckDuckGo",
  snippet: "Typed JavaScript at scale.",
  title: "TypeScript",
  url: "https://www.typescriptlang.org/",
};

function fakeClient() {
  return {
    codeSearch: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([searchResult]),
    searchStream: vi.fn(),
  };
}

describe("web_search AI SDK tool", () => {
  it("accepts camelCase search counts and rejects snake_case aliases", () => {
    const tool = createWebSearchTool({ client: fakeClient() });

    const camelCaseCount = tool.inputSchema.safeParse({
      numResults: 6,
      query: "typescript docs",
    });
    const snakeCaseResultCountKey = ["max", "results"].join("_");
    const snakeCaseCount = tool.inputSchema.safeParse({
      [snakeCaseResultCountKey]: 7,
      query: "typescript docs",
    });

    expect(camelCaseCount.success).toBe(true);
    expect(snakeCaseCount.success).toBe(false);
  });

  it("routes numResults to search execution", async () => {
    const client = fakeClient();
    const tool = createWebSearchTool({ client });

    const output = await tool.execute(
      {
        numResults: 4,
        query: "typescript docs",
      },
      toolExecutionOptions
    );

    expect(client.search).toHaveBeenCalledWith("typescript docs", 4);
    expect(output).toStrictEqual([searchResult]);
  });

  it("defaults search execution to 5 results", async () => {
    const client = fakeClient();
    const tool = createWebSearchTool({ client });

    await tool.execute({ query: "default count" }, toolExecutionOptions);

    expect(client.search).toHaveBeenCalledWith("default count", 5);
  });

  it("rejects search counts above 15 through the returned schema", () => {
    const tool = createWebSearchTool({ client: fakeClient() });

    const parsed = tool.inputSchema.safeParse({
      numResults: 16,
      query: "too many results",
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps output parsing aligned with every core search engine", () => {
    for (const engine of SEARCH_ENGINE_NAMES) {
      const validResults = [
        {
          engine,
          snippet: `Result from ${engine}`,
          title: `${engine} result`,
          url: "https://example.com/result",
        },
      ];

      expect(webSearchOutputSchema.parse(validResults)).toStrictEqual(
        searchResultsSchema.parse(validResults)
      );
    }
  });

  it("returns a structured array instead of MCP content text blocks", async () => {
    const tool = createWebSearchTool({ client: fakeClient() });

    const output = await tool.execute(
      { query: "structured output" },
      toolExecutionOptions
    );

    expect(Array.isArray(output)).toBe(true);
    expect(output).not.toHaveProperty("content");
    expect(output[0]?.url).toBe("https://www.typescriptlang.org/");
  });

  it("rejects runtime errors from the search client", async () => {
    const client = fakeClient();
    client.search.mockRejectedValueOnce(new Error("search failed"));
    const tool = createWebSearchTool({ client });

    await expect(
      tool.execute({ query: "failure" }, toolExecutionOptions)
    ).rejects.toThrow("search failed");
  });
});

import type { OpenSearchEvent } from "@minpeter/opensearch";
import type { ToolExecutionOptions } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenSearchTools as createRootOpenSearchTools,
  createWebSearchTool as createRootWebSearchTool,
} from "../index.ts";
import {
  createOpenSearchTools as createNodeOpenSearchTools,
  createWebFetchTool as createNodeWebFetchTool,
  createWebSearchTool as createNodeWebSearchTool,
} from "../node.ts";

const toolExecutionOptions: ToolExecutionOptions<unknown> = {
  context: undefined,
  messages: [],
  toolCallId: "tool-call-test",
};
const clientConflictErrorPattern = /client.*openSearchOptions/i;

function fakeClient() {
  return {
    codeSearch: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    searchStream: vi.fn(),
  };
}

describe("OpenSearch AI SDK tool composition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes web_search, web_fetch, and code_search from root and node factories", () => {
    const client = fakeClient();

    const rootTools = createRootOpenSearchTools({ client });
    const nodeTools = createNodeOpenSearchTools({ client });
    expect(Object.keys(rootTools)).toStrictEqual([
      "web_search",
      "web_fetch",
      "code_search",
    ]);
    expect(Object.keys(nodeTools)).toStrictEqual([
      "web_search",
      "web_fetch",
      "code_search",
    ]);
    expect(typeof rootTools.web_search.execute).toBe("function");
    expect(typeof nodeTools.web_fetch.execute).toBe("function");
    expect(typeof createNodeWebFetchTool).toBe("function");
    expect(typeof createNodeWebSearchTool).toBe("function");
  });

  it("forwards edge runtime options without changing tool output", async () => {
    const events: OpenSearchEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                content: "Observed through the AI SDK adapter.",
                title: "Observed adapter result",
                url: "https://example.com/adapter",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      )
    );
    const tool = createRootWebSearchTool({
      openSearchOptions: {
        env: {
          OPENSEARCH_ENABLE_EXA_MCP: "false",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
          OPENSEARCH_TAVILY_URL: "https://tavily.example/search",
          TAVILY_API_KEY: "test-key",
        },
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
    });

    const output = await tool.execute(
      { numResults: 2, query: "adapter observability" },
      toolExecutionOptions
    );

    expect(output).toEqual([
      {
        engine: "Tavily",
        snippet: "Observed through the AI SDK adapter.",
        title: "Observed adapter result",
        url: "https://example.com/adapter",
      },
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "search",
          phase: "success",
          type: "operation",
        }),
        expect.objectContaining({
          phase: "success",
          provider: "Tavily",
          type: "provider",
        }),
      ])
    );
  });

  it("throws when client and openSearchOptions are both provided", () => {
    expect(() =>
      createRootOpenSearchTools({
        client: fakeClient(),
        openSearchOptions: {},
      })
    ).toThrow(clientConflictErrorPattern);
  });
});

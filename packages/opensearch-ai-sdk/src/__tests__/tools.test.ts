import type {
  CodeSearchOptions,
  CodeSearchResult,
  FetchOptions,
  FetchResult,
  OpenSearchClient,
  OpenSearchEvent,
  SearchResult,
} from "@minpeter/opensearch";
import type { ToolExecutionOptions } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenSearchTools as createRootOpenSearchTools,
  createWebFetchTool as createRootWebFetchTool,
  createWebSearchTool as createRootWebSearchTool,
} from "../index.ts";
import {
  createOpenSearchTools as createNodeOpenSearchTools,
  createWebFetchTool as createNodeWebFetchTool,
  createWebSearchTool as createNodeWebSearchTool,
} from "../node.ts";

interface SearchCall {
  readonly maxResults: number | undefined;
  readonly query: string;
}

interface FetchCall {
  readonly maxCharacters: number | undefined;
  readonly urls: readonly string[];
}

interface FakeOpenSearchClientOptions {
  readonly fetchError?: Error;
  readonly fetchResults?: readonly FetchResult[];
  readonly searchError?: Error;
  readonly searchResults?: readonly SearchResult[];
}

const toolExecutionOptions: ToolExecutionOptions<unknown> = {
  context: undefined,
  messages: [],
  toolCallId: "tool-call-test",
};
const clientConflictErrorPattern = /client.*openSearchOptions/i;

const searchResult: SearchResult = {
  engine: "DuckDuckGo",
  snippet: "Typed JavaScript at scale.",
  title: "TypeScript",
  url: "https://www.typescriptlang.org/",
};

const fetchResult: FetchResult = {
  content: "# Example\nReadable content.",
  length: 27,
  title: "Example",
  url: "https://example.com/",
};

class FakeOpenSearchClient implements OpenSearchClient {
  readonly #fetchCalls: FetchCall[] = [];
  readonly #fetchError: Error | undefined;
  readonly #fetchResults: FetchResult[];
  readonly #searchCalls: SearchCall[] = [];
  readonly #searchError: Error | undefined;
  readonly #searchResults: SearchResult[];

  constructor(options: FakeOpenSearchClientOptions = {}) {
    this.#fetchError = options.fetchError;
    this.#fetchResults = [...(options.fetchResults ?? [fetchResult])];
    this.#searchError = options.searchError;
    this.#searchResults = [...(options.searchResults ?? [searchResult])];
  }

  get fetchCalls(): readonly FetchCall[] {
    return this.#fetchCalls;
  }

  get searchCalls(): readonly SearchCall[] {
    return this.#searchCalls;
  }

  codeSearch(
    _query: string,
    _options?: CodeSearchOptions
  ): Promise<CodeSearchResult[]> {
    return Promise.resolve([]);
  }

  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  fetch(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]>;
  fetch(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]> {
    if (this.#fetchError) {
      throw this.#fetchError;
    }

    const urls = typeof input === "string" ? [input] : [...input];
    this.#fetchCalls.push({
      maxCharacters: options?.maxCharacters,
      urls,
    });

    if (typeof input === "string") {
      const [firstResult] = this.#fetchResults;

      if (!firstResult) {
        throw new Error("Fake fetch returned no result.");
      }

      return Promise.resolve(firstResult);
    }

    return Promise.resolve([...this.#fetchResults]);
  }

  search(query: string, maxResults?: number): Promise<SearchResult[]> {
    if (this.#searchError) {
      throw this.#searchError;
    }

    this.#searchCalls.push({ maxResults, query });

    return Promise.resolve([...this.#searchResults]);
  }

  // biome-ignore lint/suspicious/useAwait: the OpenSearchClient interface requires an async generator, so the fake stays async even though it yields synchronously
  async *searchStream(
    _query: string,
    _numResults?: number
  ): AsyncGenerator<SearchResult[], void, undefined> {
    if (this.#searchError) {
      throw this.#searchError;
    }
    yield [...this.#searchResults];
  }
}

describe("OpenSearch AI SDK tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes web_search, web_fetch, and code_search from root and node factories", () => {
    const client = new FakeOpenSearchClient();

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

  it("accepts camelCase search counts and rejects snake_case aliases", () => {
    const tool = createRootWebSearchTool({
      client: new FakeOpenSearchClient(),
    });

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
    const client = new FakeOpenSearchClient();
    const tool = createRootWebSearchTool({ client });

    const output = await tool.execute(
      {
        numResults: 4,
        query: "typescript docs",
      },
      toolExecutionOptions
    );

    expect(client.searchCalls).toStrictEqual([
      { maxResults: 4, query: "typescript docs" },
    ]);
    expect(output).toStrictEqual([searchResult]);
  });

  it("forwards edge client observability options without changing tool output", async () => {
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

  it("defaults search execution to 5 results", async () => {
    const client = new FakeOpenSearchClient();
    const tool = createRootWebSearchTool({ client });

    await tool.execute({ query: "default count" }, toolExecutionOptions);

    expect(client.searchCalls).toStrictEqual([
      { maxResults: 5, query: "default count" },
    ]);
  });

  it("rejects search counts above 15 through the returned schema", () => {
    const tool = createRootWebSearchTool({
      client: new FakeOpenSearchClient(),
    });

    const parsed = tool.inputSchema.safeParse({
      numResults: 16,
      query: "too many results",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects empty and oversized fetch URL batches through the returned schema", () => {
    const tool = createRootWebFetchTool({ client: new FakeOpenSearchClient() });

    const emptyBatch = tool.inputSchema.safeParse({ urls: [] });
    const oversizedBatch = tool.inputSchema.safeParse({
      urls: Array.from(
        { length: 11 },
        (_value, index) => `https://example.com/${index}`
      ),
    });

    expect(emptyBatch.success).toBe(false);
    expect(oversizedBatch.success).toBe(false);
  });

  it("routes urls and maxCharacters to fetch execution", async () => {
    const client = new FakeOpenSearchClient();
    const tool = createRootWebFetchTool({ client });

    const output = await tool.execute(
      {
        maxCharacters: 1200,
        urls: ["https://example.com/a", "https://example.com/b"],
      },
      toolExecutionOptions
    );

    expect(client.fetchCalls).toStrictEqual([
      {
        maxCharacters: 1200,
        urls: ["https://example.com/a", "https://example.com/b"],
      },
    ]);
    expect(output).toStrictEqual([fetchResult]);
  });

  it("returns structured arrays instead of MCP content text blocks", async () => {
    const client = new FakeOpenSearchClient();
    const searchTool = createRootWebSearchTool({ client });
    const fetchTool = createRootWebFetchTool({ client });

    const searchOutput = await searchTool.execute(
      { query: "structured output" },
      toolExecutionOptions
    );
    const fetchOutput = await fetchTool.execute(
      { urls: ["https://example.com/"] },
      toolExecutionOptions
    );

    expect(Array.isArray(searchOutput)).toBe(true);
    expect(searchOutput).not.toHaveProperty("content");
    expect(searchOutput[0]?.url).toBe("https://www.typescriptlang.org/");
    expect(Array.isArray(fetchOutput)).toBe(true);
    expect(fetchOutput).not.toHaveProperty("content");
    expect(fetchOutput[0]?.content).toContain("Readable content.");
  });

  it("throws when client and openSearchOptions are both provided", () => {
    expect(() =>
      createRootOpenSearchTools({
        client: new FakeOpenSearchClient(),
        openSearchOptions: {},
      })
    ).toThrow(clientConflictErrorPattern);
  });

  it("rejects runtime errors from the search client", async () => {
    const tool = createRootWebSearchTool({
      client: new FakeOpenSearchClient({
        searchError: new Error("search failed"),
      }),
    });

    await expect(
      tool.execute({ query: "failure" }, toolExecutionOptions)
    ).rejects.toThrow("search failed");
  });

  it("rejects runtime errors from the fetch client", async () => {
    const tool = createRootWebFetchTool({
      client: new FakeOpenSearchClient({
        fetchError: new Error("fetch failed"),
      }),
    });

    await expect(
      tool.execute({ urls: ["https://example.com/"] }, toolExecutionOptions)
    ).rejects.toThrow("fetch failed");
  });
});

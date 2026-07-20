import { describe, expect, it, vi } from "vitest";
import {
  createOpenSearchWithRuntime,
  type OpenSearchEvent,
} from "../client.ts";
import { createFetchResult } from "../fetch/result.ts";
import {
  createOpenSearchObserver,
  type OpenSearchOperationEvent,
} from "../observability.ts";
import { SearchEngineError } from "../search/errors.ts";
import type { SearchProvider, SearchResult } from "../search/types.ts";

const DISABLE_HOSTED_ENV = {
  OPENSEARCH_ENABLE_EXA_MCP: "false",
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
  OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
} as const;

const searchResult: SearchResult = {
  engine: "DuckDuckGo",
  snippet: "Observed without exposing the query.",
  title: "Observable result",
  url: "https://example.com/result",
};

function successfulSearchProvider(): SearchProvider {
  return {
    name: "DuckDuckGo",
    search: vi.fn().mockResolvedValue([searchResult]),
  };
}

describe("OpenSearch observability", () => {
  it("keeps operation IDs unique across client observers", () => {
    const firstObserver = createOpenSearchObserver();
    const secondObserver = createOpenSearchObserver();

    expect(firstObserver.createOperationId("search")).not.toBe(
      secondObserver.createOperationId("search")
    );
  });

  it("emits search attempts, fallback, latency, and cache status", async () => {
    const events: OpenSearchEvent[] = [];
    const firstProvider: SearchProvider = {
      name: "Brave",
      search: vi
        .fn()
        .mockRejectedValue(
          new SearchEngineError(
            "Brave",
            "transient",
            "upstream reflected sensitive query and https://secret.example/",
            { status: 503 }
          )
        ),
    };
    const secondProvider = successfulSearchProvider();
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      { searchProviders: () => [firstProvider, secondProvider] }
    );

    await expect(client.search("sensitive query", 3)).resolves.toEqual([
      searchResult,
    ]);
    await expect(client.search("sensitive query", 3)).resolves.toEqual([
      searchResult,
    ]);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureKind: "transient",
          operation: "search",
          phase: "failure",
          provider: "Brave",
          status: 503,
          type: "provider",
        }),
        expect.objectContaining({
          fromProvider: "Brave",
          reason: "transient",
          toProvider: "DuckDuckGo",
          type: "fallback",
        }),
        expect.objectContaining({
          operation: "search",
          phase: "success",
          provider: "DuckDuckGo",
          resultCount: 1,
          type: "provider",
        }),
        expect.objectContaining({ status: "miss", type: "cache" }),
        expect.objectContaining({ status: "hit", type: "cache" }),
      ])
    );
    const completedOperations = events.filter(
      (event): event is OpenSearchOperationEvent =>
        event.type === "operation" && event.phase === "success"
    );
    expect(completedOperations).toHaveLength(2);
    expect(
      completedOperations.every(
        (event) => event.durationMs !== undefined && event.durationMs >= 0
      )
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("sensitive query");
    expect(JSON.stringify(events)).not.toContain("secret.example");
  });

  it("emits fetch provider and cache events without exposing URLs", async () => {
    const events: OpenSearchEvent[] = [];
    const localFetch = vi.fn(async (requestedUrl: string) =>
      createFetchResult(requestedUrl, "Observed local content", "Observed page")
    );
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      { localFetch }
    );
    const url = "https://private-query.example.org/observed";

    await client.fetch(url);
    await client.fetch(url);

    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "fetch",
          phase: "empty",
          provider: "public-api",
          type: "provider",
        }),
        expect.objectContaining({
          fromProvider: "public-api",
          toProvider: "local",
          type: "fallback",
        }),
        expect.objectContaining({
          operation: "fetch",
          phase: "success",
          provider: "local",
          type: "provider",
        }),
        expect.objectContaining({ status: "miss", type: "cache" }),
        expect.objectContaining({ status: "hit", type: "cache" }),
      ])
    );
    expect(JSON.stringify(events)).not.toContain(url);
  });

  it("records a public-API fallback for the unresolved part of a mixed batch", async () => {
    const events: OpenSearchEvent[] = [];
    const redditUrl = "https://www.reddit.com/r/x/comments/abc/title/";
    const genericUrl = "https://example.com/generic";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            data: {
              children: [{ data: { selftext: "Body", title: "Post" } }],
            },
          },
          { data: { children: [] } },
        ])
      )
    );
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      {
        localFetch: async (url) =>
          createFetchResult(url, "Local content", "Local page"),
      }
    );

    const results = await client.fetch([redditUrl, genericUrl]);

    expect(results.map((result) => result.title)).toEqual([
      "Post",
      "Local page",
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromProvider: "public-api",
          reason: "empty",
          toProvider: "local",
          type: "fallback",
        }),
      ])
    );
  });

  it("records provider and operation failures", async () => {
    const events: OpenSearchEvent[] = [];
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      {
        localFetch: () => Promise.reject(new Error("local extraction failed")),
      }
    );

    await expect(client.fetch("https://example.com/failure")).rejects.toThrow(
      "local extraction failed"
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "failure",
          provider: "local",
          type: "provider",
        }),
        expect.objectContaining({
          operation: "fetch",
          phase: "failure",
          type: "operation",
        }),
      ])
    );
  });

  it("isolates synchronous throws and async rejections from event sinks", async () => {
    const provider = successfulSearchProvider();
    const throwingClient = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: () => {
            throw new Error("sink failed");
          },
        },
      },
      { searchProviders: () => [provider] }
    );
    const rejectingClient = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: () => Promise.reject(new Error("async sink failed")),
        },
      },
      { searchProviders: () => [provider] }
    );

    await expect(throwingClient.search("query one")).resolves.toEqual([
      searchResult,
    ]);
    await expect(rejectingClient.search("query two")).resolves.toEqual([
      searchResult,
    ]);
    await Promise.resolve();
  });
});

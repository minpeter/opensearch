import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearch,
  type NativeSearchRegistry,
  type NativeSearchRoute,
  type OpenSearchEvent,
  SearchEngineError,
} from "../index.ts";
import { createMockJsonResponse } from "./search-test-helpers.ts";

function createRoute(
  id: string,
  engine: NativeSearchRoute["engine"],
  search: NativeSearchRoute["search"]
): NativeSearchRoute {
  return { engine, id, search };
}

describe("native search registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("falls through retryable native failures and stops on unknown errors", async () => {
    const invalidError = new Error("invalid native request");
    const invalidSearch = vi.fn().mockRejectedValue(invalidError);
    const fallbackSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Fallback result",
        title: "Discovered provider",
        url: "https://fallback.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: vi
        .fn()
        .mockResolvedValueOnce({
          active: createRoute("session:kimi", "Kimi", () =>
            Promise.reject(
              new SearchEngineError(
                "Kimi",
                "transient",
                "native provider unavailable"
              )
            )
          ),
          available: [
            createRoute("session:anthropic", "Anthropic", fallbackSearch),
          ],
        })
        .mockResolvedValue({
          active: createRoute("session:kimi", "Kimi", invalidSearch),
          available: [
            createRoute("session:anthropic", "Anthropic", fallbackSearch),
          ],
        }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("retryable failure", 2)).resolves.toEqual([
      {
        engine: "Anthropic",
        snippet: "Fallback result",
        title: "Discovered provider",
        url: "https://fallback.example/result",
      },
    ]);
    await expect(client.search("invalid request", 2)).rejects.toBe(
      invalidError
    );
    expect(fallbackSearch).toHaveBeenCalledOnce();
    expect(invalidSearch).toHaveBeenCalledOnce();
  });

  it("reports a classified registry failure before using base providers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockJsonResponse({
        results: [
          {
            content: "Base provider result",
            title: "Tavily",
            url: "https://tavily.example/result",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);
    const registry: NativeSearchRegistry = {
      resolve: () =>
        Promise.reject(
          new SearchEngineError(
            "Kimi",
            "misconfigured",
            "native registry unavailable"
          )
        ),
    };
    const client = createOpenSearch({
      env: { TAVILY_API_KEY: "tavily-test-key" },
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("base provider fallback", 1)).resolves.toEqual([
      {
        engine: "Tavily",
        snippet: "Base provider result",
        title: "Tavily",
        url: "https://tavily.example/result",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not retry or fall back after unknown registry errors", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const registryError = new Error("invalid native registry");
    const resolve = vi.fn().mockRejectedValue(registryError);
    const registry: NativeSearchRegistry = { resolve };
    const client = createOpenSearch({
      env: { TAVILY_API_KEY: "tavily-test-key" },
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("invalid registry", 1)).rejects.toBe(
      registryError
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preserves unknown registry error identity in search streams", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const registryError = new Error("invalid stream registry");
    const resolve = vi.fn().mockRejectedValue(registryError);
    const registry: NativeSearchRegistry = { resolve };
    const client = createOpenSearch({
      env: { TAVILY_API_KEY: "tavily-test-key" },
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    const stream = client.searchStream("invalid stream registry", 1);

    await expect(stream.next()).rejects.toBe(registryError);
    expect(resolve).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("observes stream failures while resolving native routes", async () => {
    const events: OpenSearchEvent[] = [];
    const registryError = new Error("invalid observed registry");
    const client = createOpenSearch({
      observability: {
        onEvent: (event) => {
          events.push(event);
        },
      },
      search: {
        cache: { enabled: false },
        nativeRegistry: {
          resolve: () => Promise.reject(registryError),
        },
      },
    });

    await expect(
      client.searchStream("observed invalid registry", 1).next()
    ).rejects.toBe(registryError);
    expect(events).toEqual([
      expect.objectContaining({
        operation: "search",
        phase: "start",
        type: "operation",
      }),
      expect.objectContaining({
        operation: "search",
        phase: "failure",
        type: "operation",
      }),
    ]);
    expect(events[0]?.operationId).toBe(events[1]?.operationId);
  });

  it("keeps malformed native results terminal", async () => {
    const fallbackSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Fallback result",
        title: "Anthropic",
        url: "https://anthropic.example/result",
      },
    ]);
    const malformedSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Malformed result",
        title: 42,
        url: "https://kimi.example/result",
      },
    ]);
    const client = createOpenSearch({
      search: {
        cache: { enabled: false },
        nativeRegistry: {
          resolve: () => ({
            active: createRoute("session:kimi", "Kimi", malformedSearch),
            available: [
              createRoute("session:anthropic", "Anthropic", fallbackSearch),
            ],
          }),
        },
      },
    });

    await expect(client.search("malformed native result", 1)).rejects.toThrow();
    expect(malformedSearch).toHaveBeenCalledOnce();
    expect(fallbackSearch).not.toHaveBeenCalled();
  });

  it("keeps unknown native route errors terminal in search streams", async () => {
    const discoveredSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Discovered result",
        title: "Anthropic",
        url: "https://anthropic.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: () => ({
        active: createRoute("session:kimi", "Kimi", () =>
          Promise.reject(new TypeError("invalid native stream request"))
        ),
        available: [
          createRoute("session:anthropic", "Anthropic", discoveredSearch),
        ],
      }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    const stream = client.searchStream("invalid stream request", 2);

    await expect(stream.next()).rejects.toThrow(
      "invalid native stream request"
    );
    expect(discoveredSearch).toHaveBeenCalledOnce();
  });
});

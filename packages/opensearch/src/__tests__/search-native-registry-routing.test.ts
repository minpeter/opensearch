import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearch,
  type NativeSearchRegistry,
  type NativeSearchRoute,
  SearchEngineError,
} from "../index.ts";

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

  it("routes through the active provider before unique discovered providers", async () => {
    const activeSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Native result",
        title: "Active provider",
        url: "https://active.example/result",
      },
    ]);
    const duplicateSearch = vi.fn();
    const discoveredSearch = vi.fn();
    const registry: NativeSearchRegistry = {
      resolve: vi.fn().mockResolvedValue({
        active: createRoute("session:kimi", "Kimi", activeSearch),
        available: [
          createRoute("session:kimi", "Kimi", duplicateSearch),
          createRoute("session:anthropic", "Anthropic", discoveredSearch),
        ],
      }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("native routing", 3)).resolves.toEqual([
      {
        engine: "Kimi",
        snippet: "Native result",
        title: "Active provider",
        url: "https://active.example/result",
      },
    ]);
    expect(registry.resolve).toHaveBeenCalledOnce();
    expect(activeSearch).toHaveBeenCalledWith("native routing", 3, {
      signal: expect.any(AbortSignal),
    });
    expect(duplicateSearch).not.toHaveBeenCalled();
    expect(discoveredSearch).not.toHaveBeenCalled();
  });

  it("refreshes available subscription routes for each uncached search", async () => {
    const firstSearch = vi.fn().mockResolvedValue([
      {
        snippet: "First session",
        title: "Kimi",
        url: "https://kimi.example/result",
      },
    ]);
    const secondSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Second session",
        title: "OpenAI",
        url: "https://openai.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: vi
        .fn()
        .mockResolvedValueOnce({
          active: createRoute("session:kimi", "Kimi", firstSearch),
          available: [],
        })
        .mockResolvedValueOnce({
          active: createRoute("session:openai", "OpenAI", secondSearch),
          available: [],
        }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("first")).resolves.toEqual([
      expect.objectContaining({ engine: "Kimi" }),
    ]);
    await expect(client.search("second")).resolves.toEqual([
      expect.objectContaining({ engine: "OpenAI" }),
    ]);
    expect(registry.resolve).toHaveBeenCalledTimes(2);
    expect(firstSearch).toHaveBeenCalledOnce();
    expect(secondSearch).toHaveBeenCalledOnce();
  });

  it("keeps cached results until a search explicitly bypasses the cache", async () => {
    const firstSearch = vi.fn().mockResolvedValue([
      {
        snippet: "First session",
        title: "Kimi",
        url: "https://kimi.example/result",
      },
    ]);
    const secondSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Second session",
        title: "OpenAI",
        url: "https://openai.example/result",
      },
    ]);
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({
        active: createRoute("session:kimi", "Kimi", firstSearch),
        available: [],
      })
      .mockResolvedValueOnce({
        active: createRoute("session:openai", "OpenAI", secondSearch),
        available: [],
      });
    const client = createOpenSearch({
      search: { nativeRegistry: { resolve } },
    });

    await expect(client.search("cached session")).resolves.toEqual([
      expect.objectContaining({ engine: "Kimi" }),
    ]);
    await expect(client.search("cached session")).resolves.toEqual([
      expect.objectContaining({ engine: "Kimi" }),
    ]);
    await expect(
      client.search("cached session", 10, { cache: "bypass" })
    ).resolves.toEqual([expect.objectContaining({ engine: "OpenAI" })]);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(firstSearch).toHaveBeenCalledOnce();
    expect(secondSearch).toHaveBeenCalledOnce();
  });

  it("uses one registry snapshot across retry attempts", async () => {
    vi.useFakeTimers();
    const nativeSearch = vi
      .fn()
      .mockRejectedValueOnce(
        new SearchEngineError("Kimi", "transient", "first attempt failed")
      )
      .mockRejectedValueOnce(
        new SearchEngineError("Kimi", "transient", "second attempt failed")
      )
      .mockResolvedValue([
        {
          snippet: "Recovered session",
          title: "Kimi",
          url: "https://kimi.example/recovered",
        },
      ]);
    const resolve = vi.fn(() => ({
      active: createRoute("session:kimi", "Kimi", nativeSearch),
      available: [],
    }));
    const client = createOpenSearch({
      search: {
        cache: { enabled: false },
        nativeRegistry: { resolve },
      },
    });

    const searchPromise = client.search("retry one snapshot");
    await vi.runAllTimersAsync();

    await expect(searchPromise).resolves.toEqual([
      expect.objectContaining({ engine: "Kimi" }),
    ]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(nativeSearch).toHaveBeenCalledTimes(3);
  });

  it("falls through when a native route returns no results", async () => {
    const fallbackSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Fallback result",
        title: "Discovered provider",
        url: "https://fallback.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: () => ({
        active: createRoute("session:kimi", "Kimi", () => Promise.resolve([])),
        available: [
          createRoute("session:anthropic", "Anthropic", fallbackSearch),
        ],
      }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    await expect(client.search("no native hits", 2)).resolves.toEqual([
      expect.objectContaining({ engine: "Anthropic" }),
    ]);
    expect(fallbackSearch).toHaveBeenCalledOnce();
  });
});

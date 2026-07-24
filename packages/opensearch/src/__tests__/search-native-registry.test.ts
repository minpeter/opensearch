import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearch,
  type NativeSearchRegistry,
  type NativeSearchRoute,
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

  it("aborts a stalled native route and falls through after its timeout", async () => {
    vi.useFakeTimers();
    const onAbort = vi.fn();
    const fallbackSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Fallback result",
        title: "Discovered provider",
        url: "https://fallback.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: () => ({
        active: {
          engine: "Kimi",
          id: "session:kimi",
          search: (_query, _numResults, options) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => {
                  onAbort();
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true }
              );
            }),
          timeoutMs: 25,
        },
        available: [
          createRoute("session:anthropic", "Anthropic", fallbackSearch),
        ],
      }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    const searchPromise = client.search("stalled native route", 2);
    await vi.advanceTimersByTimeAsync(25);

    await expect(searchPromise).resolves.toEqual([
      expect.objectContaining({ engine: "Anthropic" }),
    ]);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(fallbackSearch).toHaveBeenCalledOnce();
  });

  it("uses the eight-second timeout when a route omits its deadline", async () => {
    vi.useFakeTimers();
    const onAbort = vi.fn();
    const fallbackSearch = vi.fn().mockResolvedValue([
      {
        snippet: "Fallback result",
        title: "Discovered provider",
        url: "https://fallback.example/result",
      },
    ]);
    const registry: NativeSearchRegistry = {
      resolve: () => ({
        active: createRoute(
          "session:kimi",
          "Kimi",
          (_query, _numResults, options) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => {
                  onAbort();
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true }
              );
            })
        ),
        available: [
          createRoute("session:anthropic", "Anthropic", fallbackSearch),
        ],
      }),
    };
    const client = createOpenSearch({
      search: { cache: { enabled: false }, nativeRegistry: registry },
    });

    const searchPromise = client.search("default native timeout", 2);
    await vi.advanceTimersByTimeAsync(7999);
    expect(onAbort).not.toHaveBeenCalled();
    expect(fallbackSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(searchPromise).resolves.toEqual([
      expect.objectContaining({ engine: "Anthropic" }),
    ]);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(fallbackSearch).toHaveBeenCalledOnce();
  });
});

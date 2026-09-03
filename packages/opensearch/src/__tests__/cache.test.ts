import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TtlCache } from "../cache.ts";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves a value", () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("has() returns true for a cached key", () => {
    const cache = new TtlCache<string, number>(60_000);
    cache.set("num", 42);
    expect(cache.has("num")).toBe(true);
  });

  it("returns undefined for missing key", () => {
    const cache = new TtlCache<string, string>(60_000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("has() returns false for missing key", () => {
    const cache = new TtlCache<string, string>(60_000);
    expect(cache.has("missing")).toBe(false);
  });

  it("returns undefined after TTL expiry", () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set("key", "value");
    vi.advanceTimersByTime(61_000);
    expect(cache.get("key")).toBeUndefined();
  });

  it("has() returns false after TTL expiry", () => {
    const cache = new TtlCache<string, string>(60_000);
    cache.set("key", "value");
    vi.advanceTimersByTime(61_000);
    expect(cache.has("key")).toBe(false);
  });

  it("works with array values", () => {
    const cache = new TtlCache<string, number[]>(60_000);
    cache.set("arr", [1, 2, 3]);
    expect(cache.get("arr")).toEqual([1, 2, 3]);
  });

  it("works with object values", () => {
    const cache = new TtlCache<string, { name: string }>(60_000);
    cache.set("obj", { name: "test" });
    expect(cache.get("obj")).toEqual({ name: "test" });
  });

  it("deduplicates concurrent misses for the same key", async () => {
    const cache = new TtlCache<string, string>(60_000);
    const factory = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("value"), 10);
        })
    );

    const firstPromise = cache.getOrSet("key", factory);
    const secondPromise = cache.getOrSet("key", factory);

    vi.advanceTimersByTime(10);

    await expect(firstPromise).resolves.toBe("value");
    await expect(secondPromise).resolves.toBe("value");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected factory call", async () => {
    const cache = new TtlCache<string, string>(60_000);
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("value");

    await expect(cache.getOrSet("key", factory)).rejects.toThrow("boom");
    await expect(cache.getOrSet("key", factory)).resolves.toBe("value");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not invoke a factory for a pre-aborted waiter", async () => {
    // Given: a cache waiter whose caller already aborted.
    const cache = new TtlCache<string, string>(60_000);
    const reason = new Error("caller already left");
    const controller = new AbortController();
    controller.abort(reason);
    const waiter = cache.createWaiter(controller.signal);
    const factory = vi.fn(() => Promise.resolve("value"));

    // When: the aborted waiter requests an uncached value.
    const result = cache.getOrSet("key", factory, waiter);

    // Then: the request rejects without starting a cache generation.
    await expect(result).rejects.toBe(reason);
    expect(factory).not.toHaveBeenCalled();
    cache.releaseWaiter(waiter);
  });

  it("starts a fresh generation synchronously after the last waiter aborts", async () => {
    const cache = new TtlCache<string, string>(60_000);
    const firstResult = Promise.withResolvers<string>();
    const secondResult = Promise.withResolvers<string>();
    const generations: AbortSignal[] = [];
    const factory = vi.fn((signal: AbortSignal) => {
      generations.push(signal);
      return generations.length === 1
        ? firstResult.promise
        : secondResult.promise;
    });
    const controller = new AbortController();
    const waiter = cache.createWaiter(controller.signal);

    const first = cache.getOrSet("key", factory, waiter);
    controller.abort(new Error("first caller left"));
    const second = cache.getOrSet("key", factory);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(generations[0]?.aborted).toBe(true);
    expect(generations[1]?.aborted).toBe(false);

    firstResult.resolve("old");
    await expect(first).resolves.toBe("old");
    const joinedSecond = cache.getOrSet("key", factory);
    expect(factory).toHaveBeenCalledTimes(2);

    secondResult.resolve("new");
    await expect(second).resolves.toBe("new");
    await expect(joinedSecond).resolves.toBe("new");
    cache.releaseWaiter(waiter);
  });

  it("retires a generation when its factory synchronously aborts the waiter", async () => {
    const cache = new TtlCache<string, string>(60_000);
    const controller = new AbortController();
    const reason = new Error("factory aborted caller");
    const firstWaiter = cache.createWaiter(controller.signal);
    let firstGeneration: AbortSignal | undefined;
    const first = cache.getOrSet(
      "key",
      (signal) => {
        firstGeneration = signal;
        controller.abort(reason);
        return new Promise<string>(() => undefined);
      },
      firstWaiter
    );

    await expect(firstWaiter.waitFor(first)).rejects.toBe(reason);
    cache.releaseWaiter(firstWaiter);
    expect(firstGeneration?.aborted).toBe(true);

    const secondWaiter = cache.createWaiter();
    const secondFactory = vi.fn(async () => "fresh");
    const second = cache.getOrSet("key", secondFactory, secondWaiter);
    await expect(secondWaiter.waitFor(second)).resolves.toBe("fresh");
    cache.releaseWaiter(secondWaiter);
    expect(secondFactory).toHaveBeenCalledOnce();
  });

  it("bounds high-cardinality workloads by default", () => {
    const cache = new TtlCache<number, number>(60_000);

    for (let index = 0; index < 10_000; index += 1) {
      cache.set(index, index);
    }

    expect(cache.size).toBe(256);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(9999)).toBe(9999);
  });

  it("evicts the least recently used entry at a custom capacity", () => {
    const cache = new TtlCache<string, number>(60_000, { maxEntries: 2 });
    cache.set("first", 1);
    cache.set("second", 2);
    expect(cache.get("first")).toBe(1);

    cache.set("third", 3);

    expect(cache.get("first")).toBe(1);
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("third")).toBe(3);
  });

  it("sweeps expired entries before evicting live entries", () => {
    const cache = new TtlCache<string, number>(1000, { maxEntries: 2 });
    cache.set("first", 1);
    cache.set("second", 2);
    vi.advanceTimersByTime(1001);

    cache.set("third", 3);

    expect(cache.size).toBe(1);
    expect(cache.get("third")).toBe(3);
  });

  it("rejects invalid TTL and capacity values", () => {
    expect(() => new TtlCache(0)).toThrow("ttlMs");
    expect(() => new TtlCache(1000, { maxEntries: 0 })).toThrow("maxEntries");
  });
});

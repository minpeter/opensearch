import { describe, expect, it, vi } from "vitest";
import type { FetchOperations } from "../fetch/orchestration.ts";
import type { FetchResult } from "../fetch/result.ts";
import { createFetchServiceForOperations } from "../fetch-service.ts";
import { createOpenSearchObserver } from "../observability.ts";

const CACHE_OPTIONS = { enabled: true, maxEntries: 16, ttlMs: 60_000 };

function resultFor(url: string): FetchResult {
  return { content: `content for ${url}`, length: 10, title: "t", url };
}

function operationsReturning(results: FetchResult[]): FetchOperations {
  return {
    fetchUrl: vi
      .fn()
      .mockImplementation((url: string) => Promise.resolve(resultFor(url))),
    fetchUrls: vi.fn().mockResolvedValue(results),
  };
}

function controllableOperations(): {
  readonly batchCalls: Array<{
    readonly promise: ReturnType<typeof deferred<FetchResult[]>>;
    readonly urls: string[];
  }>;
  readonly operations: FetchOperations;
} {
  const batchCalls: Array<{
    readonly promise: ReturnType<typeof deferred<FetchResult[]>>;
    readonly urls: string[];
  }> = [];
  return {
    batchCalls,
    operations: {
      fetchUrl: vi.fn().mockResolvedValue(resultFor("https://b.example/")),
      fetchUrls: vi.fn((urls: string[]) => {
        const promise = deferred<FetchResult[]>();
        batchCalls.push({ promise, urls });
        return promise.promise;
      }),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("fetchUrlsWithCache result mapping", () => {
  it("maps results back to requested URLs when the provider canonicalizes them", async () => {
    const operations = operationsReturning([
      resultFor("https://a.example/"),
      resultFor("https://canonical.example/"),
    ]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    const results = await service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);

    expect(results.map((result) => result.content)).toEqual([
      "content for https://a.example/",
      "content for https://canonical.example/",
    ]);
  });

  it("keys the populated cache by the requested URL, not the canonical one", async () => {
    const operations = operationsReturning([
      resultFor("https://a.example/"),
      resultFor("https://canonical.example/"),
    ]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    await service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    const cached = await service.fetchUrlWithCache("https://b.example/");

    expect(cached.content).toBe("content for https://canonical.example/");
    expect(operations.fetchUrl).not.toHaveBeenCalled();
  });

  it("coalesces overlapping concurrent batch misses", async () => {
    const { batchCalls, operations } = controllableOperations();
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    const first = service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    await vi.waitFor(() => expect(batchCalls).toHaveLength(1));
    expect(batchCalls[0]?.urls).toEqual([
      "https://a.example/",
      "https://b.example/",
    ]);

    const second = service.fetchUrlsWithCache([
      "https://b.example/",
      "https://c.example/",
    ]);
    await vi.waitFor(() => expect(batchCalls).toHaveLength(2));
    expect(batchCalls[1]?.urls).toEqual(["https://c.example/"]);

    batchCalls[0]?.promise.resolve([
      resultFor("https://a.example/"),
      resultFor("https://b.example/"),
    ]);
    batchCalls[1]?.promise.resolve([resultFor("https://c.example/")]);

    await expect(first).resolves.toHaveLength(2);
    await expect(second).resolves.toEqual([
      resultFor("https://b.example/"),
      resultFor("https://c.example/"),
    ]);
  });

  it("coalesces a single fetch with an in-flight batch miss", async () => {
    const { batchCalls, operations } = controllableOperations();
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    const batch = service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    await vi.waitFor(() => expect(batchCalls).toHaveLength(1));

    const single = service.fetchUrlWithCache("https://b.example/");
    await Promise.resolve();
    expect(operations.fetchUrl).not.toHaveBeenCalled();

    batchCalls[0]?.promise.resolve([
      resultFor("https://a.example/"),
      resultFor("https://b.example/"),
    ]);

    await expect(batch).resolves.toHaveLength(2);
    await expect(single).resolves.toEqual(resultFor("https://b.example/"));
  });

  it("bypasses the cache when cache: 'bypass' is set per call", async () => {
    const operations = operationsReturning([resultFor("https://a.example/")]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    await service.fetch("https://a.example/");
    await service.fetch("https://a.example/");
    await service.fetch("https://a.example/", { cache: "bypass" });

    // First call populates the cache (1 provider call), second is a cache hit,
    // and the bypass call hits the provider again through the batch path.
    expect(operations.fetchUrl).toHaveBeenCalledTimes(1);
    expect(operations.fetchUrls).toHaveBeenCalledTimes(1);
  });

  it("accepts a union of string and string[] at the type level", async () => {
    const operations = operationsReturning([resultFor("https://a.example/")]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );
    const unionInput: string | readonly string[] = "https://a.example/";

    const result = await service.fetch(unionInput);

    expect(Array.isArray(result)).toBe(false);
  });

  it("does not poison the pending cache after a batch miss rejection", async () => {
    const { batchCalls, operations } = controllableOperations();
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    const failed = service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    await vi.waitFor(() => expect(batchCalls).toHaveLength(1));
    batchCalls[0]?.promise.reject(new Error("provider down"));
    await expect(failed).rejects.toThrow("provider down");

    const retry = service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    await vi.waitFor(() => expect(batchCalls).toHaveLength(2));
    batchCalls[1]?.promise.resolve([
      resultFor("https://a.example/"),
      resultFor("https://b.example/"),
    ]);

    await expect(retry).resolves.toHaveLength(2);
    expect(operations.fetchUrls).toHaveBeenCalledTimes(2);
  });
});

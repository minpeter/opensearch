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

interface BatchCall {
  readonly promise: ReturnType<typeof deferred<FetchResult[]>>;
  readonly signal: AbortSignal | undefined;
  readonly urls: string[];
}

function controllableOperations(): {
  readonly batchCalls: BatchCall[];
  readonly operations: FetchOperations;
  readonly waitForBatchCall: (index: number) => Promise<BatchCall>;
} {
  const batchCalls: BatchCall[] = [];
  const callWaiters = new Map<number, ReturnType<typeof deferred<BatchCall>>>();
  return {
    batchCalls,
    operations: {
      fetchUrl: vi.fn().mockResolvedValue(resultFor("https://b.example/")),
      fetchUrls: vi.fn(
        (
          urls: string[],
          _maxCharacters?: number,
          _maxConcurrency?: number,
          _operationId?: string,
          signal?: AbortSignal
        ) => {
          const promise = deferred<FetchResult[]>();
          const call = { promise, signal, urls };
          batchCalls.push(call);
          callWaiters.get(batchCalls.length - 1)?.resolve(call);
          return promise.promise;
        }
      ),
    },
    waitForBatchCall: (index: number) => {
      const call = batchCalls[index];
      if (call) {
        return Promise.resolve(call);
      }
      const waiter = deferred<BatchCall>();
      callWaiters.set(index, waiter);
      return waiter.promise;
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
    const { operations, waitForBatchCall } = controllableOperations();
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
    const failedBatchCall = await waitForBatchCall(0);
    failedBatchCall.promise.reject(new Error("provider down"));
    await expect(failed).rejects.toThrow("provider down");

    const retry = service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    const retryBatchCall = await waitForBatchCall(1);
    retryBatchCall.promise.resolve([
      resultFor("https://a.example/"),
      resultFor("https://b.example/"),
    ]);

    await expect(retry).resolves.toHaveLength(2);
    expect(operations.fetchUrls).toHaveBeenCalledTimes(2);
  });

  it("aborts the actual single transport when its sole waiter leaves", async () => {
    const transportStarted = deferred<AbortSignal | undefined>();
    const operations: FetchOperations = {
      fetchUrl: vi.fn((_url, _operationId, signal) => {
        transportStarted.resolve(signal);
        return new Promise<FetchResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }),
      fetchUrls: vi.fn(),
    };
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );
    const controller = new AbortController();

    const operation = service.fetch("https://single.example/", {
      signal: controller.signal,
    });
    const transportSignal = await transportStarted.promise;
    controller.abort(new Error("caller left"));

    await expect(operation).rejects.toThrow("caller left");
    expect(transportSignal).toMatchObject({ aborted: true });
  });

  it("keeps shared work until the last waiter leaves and aborts it once", async () => {
    const transportStarted = deferred<AbortSignal | undefined>();
    let transportAbortCount = 0;
    const operations: FetchOperations = {
      fetchUrl: vi.fn((_url, _operationId, signal) => {
        transportStarted.resolve(signal);
        return new Promise<FetchResult>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              transportAbortCount += 1;
              reject(signal.reason);
            },
            { once: true }
          );
        });
      }),
      fetchUrls: vi.fn(),
    };
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = service.fetch("https://shared.example/", {
      signal: firstController.signal,
    });
    const transportSignal = await transportStarted.promise;
    const second = service.fetch("https://shared.example/", {
      signal: secondController.signal,
    });
    firstController.abort(new Error("first left"));
    await expect(first).rejects.toThrow("first left");
    expect(transportSignal).toMatchObject({ aborted: false });

    secondController.abort(new Error("last left"));
    await expect(second).rejects.toThrow("last left");
    expect(transportSignal).toMatchObject({ aborted: true });
    expect(transportAbortCount).toBe(1);
  });

  it("aggregates cache generation signals across overlapping batches", async () => {
    const { operations, waitForBatchCall } = controllableOperations();
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = service.fetch(["https://a.example/", "https://b.example/"], {
      maxConcurrency: 4,
      signal: firstController.signal,
    });
    const firstTransport = await waitForBatchCall(0);
    const second = service.fetch(["https://b.example/", "https://c.example/"], {
      maxConcurrency: 4,
      signal: secondController.signal,
    });
    const secondTransport = await waitForBatchCall(1);

    firstController.abort(new Error("first batch left"));
    await expect(first).rejects.toThrow("first batch left");
    expect(firstTransport.signal?.aborted).toBe(false);
    expect(secondTransport.signal?.aborted).toBe(false);

    secondController.abort(new Error("last batch left"));
    await expect(second).rejects.toThrow("last batch left");
    expect(firstTransport.signal?.aborted).toBe(true);
    expect(secondTransport.signal?.aborted).toBe(true);
  });

  it("uses one caller abort listener for a ten URL batch", async () => {
    const urls = Array.from(
      { length: 10 },
      (_value, index) => `https://${index}.example/`
    );
    const operations = operationsReturning(urls.map(resultFor));
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");

    await service.fetch(urls, {
      maxConcurrency: 4,
      signal: controller.signal,
    });

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "abort")
    ).toHaveLength(1);
  });
});

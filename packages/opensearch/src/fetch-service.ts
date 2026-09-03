import { awaitAbortable, throwIfAborted } from "./abort.ts";
import {
  type CacheWaiter,
  type resolveCacheOptions,
  TtlCache,
} from "./cache.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import { requireMaxCharacters } from "./fetch/config.ts";
import type { FetchOperations } from "./fetch/orchestration.ts";
import type { FetchResult } from "./fetch/result.ts";
import type { FetchOptions, FetchService } from "./fetch.ts";
import {
  emitCacheEvent,
  type OpenSearchObserver,
  observeOperation,
} from "./observability.ts";

export function createFetchServiceForOperations(
  operations: FetchOperations,
  defaultMaxConcurrency: number,
  cacheOptions: ReturnType<typeof resolveCacheOptions>,
  observer: OpenSearchObserver
): FetchService {
  const cache = cacheOptions.enabled
    ? new TtlCache<string, FetchResult>(cacheOptions.ttlMs, {
        maxEntries: cacheOptions.maxEntries,
      })
    : null;

  function fetchSingleUrl(
    url: string,
    operationId?: string,
    signal?: AbortSignal
  ): Promise<FetchResult> {
    return operations.fetchUrl(url, operationId, signal);
  }

  function fetchMultipleUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency,
    operationId?: string,
    signal?: AbortSignal
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);
    const characterLimit =
      maxCharacters === undefined
        ? undefined
        : requireMaxCharacters(maxCharacters);
    return operations.fetchUrls(
      urls,
      characterLimit,
      maxConcurrency,
      operationId,
      signal
    );
  }

  function fetchSingleUrlWithCache(
    url: string,
    operationId?: string,
    emitCache = true,
    signal?: AbortSignal
  ): Promise<FetchResult> {
    if (cache === null) {
      if (operationId && emitCache) {
        emitCacheEvent(observer, "fetch", operationId, "bypass");
      }
      return awaitAbortable(fetchSingleUrl(url, operationId, signal), signal);
    }

    if (operationId && emitCache) {
      emitCacheEvent(
        observer,
        "fetch",
        operationId,
        cache.has(url) ? "hit" : "miss"
      );
    }
    const waiter = cache.createWaiter(signal);
    const result = waiter.waitFor(
      cache.getOrSet(
        url,
        (generationSignal) =>
          fetchSingleUrl(url, operationId, generationSignal),
        waiter
      )
    );
    return result.finally(() => cache.releaseWaiter(waiter));
  }

  async function fetchMultipleUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency,
    operationId?: string,
    signal?: AbortSignal
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);

    if (cache === null || maxCharacters !== undefined) {
      emitFetchCacheBypass(operationId);
      return awaitAbortable(
        fetchMultipleUrls(
          urls,
          maxCharacters,
          maxConcurrency,
          operationId,
          signal
        ),
        signal
      );
    }

    if (urls.length === 1) {
      const [url] = urls;
      return url
        ? [await fetchSingleUrlWithCache(url, operationId, true, signal)]
        : [];
    }

    return fetchCachedBatch(urls, maxConcurrency, operationId, cache, signal);
  }

  function emitFetchCacheBypass(operationId?: string): void {
    if (operationId) {
      emitCacheEvent(observer, "fetch", operationId, "bypass");
    }
  }

  async function fetchCachedBatch(
    urls: string[],
    maxConcurrency: number,
    operationId: string | undefined,
    activeCache: TtlCache<string, FetchResult>,
    signal?: AbortSignal
  ): Promise<FetchResult[]> {
    const uncachedUrls: string[] = [];
    const resultsByUrl = new Map<string, FetchResult>();
    for (const url of new Set(urls)) {
      const cachedResult = activeCache.get(url);
      const cacheHit = cachedResult !== undefined;
      if (operationId) {
        emitCacheEvent(
          observer,
          "fetch",
          operationId,
          cacheHit ? "hit" : "miss"
        );
      }
      if (cachedResult === undefined) {
        uncachedUrls.push(url);
      } else {
        resultsByUrl.set(url, cachedResult);
      }
    }

    if (uncachedUrls.length > 0) {
      // Single-flight: each miss goes through the cache's pending map, and the
      // factories that actually run share one deferred batch fetch. Concurrent
      // batch and single calls for the same URL join the same in-flight work.
      const batchUrls: string[] = [];
      const batchController = new AbortController();
      const generationAborts = new Map<AbortSignal, () => void>();
      const registerGeneration = (generationSignal: AbortSignal): void => {
        const abort = (): void => {
          if (
            [...generationAborts.keys()].every(
              (registeredSignal) => registeredSignal.aborted
            )
          ) {
            batchController.abort(generationSignal.reason);
          }
        };
        generationAborts.set(generationSignal, abort);
        if (generationSignal.aborted) {
          abort();
        } else {
          generationSignal.addEventListener("abort", abort, { once: true });
        }
      };
      let batchPromise: Promise<FetchResult[]> | undefined;
      const fetchBatchOnce = (): Promise<FetchResult[]> => {
        batchPromise ??= Promise.resolve()
          .then(() =>
            fetchMultipleUrls(
              [...batchUrls],
              undefined,
              maxConcurrency,
              operationId,
              batchController.signal
            )
          )
          .finally(() => {
            for (const [generationSignal, abort] of generationAborts) {
              generationSignal.removeEventListener("abort", abort);
            }
          });
        return batchPromise;
      };

      // Providers return results in request order; key by the requested URL
      // because a provider may canonicalize or redirect result.url.
      const waiter: CacheWaiter = activeCache.createWaiter(signal);
      const pendingResultsByUrl = new Map<string, Promise<FetchResult>>();
      for (const url of uncachedUrls) {
        const resultPromise = activeCache.getOrSet(
          url,
          async (generationSignal) => {
            registerGeneration(generationSignal);
            const index = batchUrls.push(url) - 1;
            const fetchedResults = await fetchBatchOnce();

            if (fetchedResults.length > batchUrls.length) {
              throw new Error("Fetch returned more results than requested.");
            }
            const result = fetchedResults[index];
            if (result === undefined) {
              throw new Error(`Fetch returned no result for ${url}.`);
            }
            return result;
          },
          waiter
        );
        pendingResultsByUrl.set(url, resultPromise);
      }

      try {
        await waiter.waitFor(
          Promise.all(
            [...pendingResultsByUrl].map(async ([url, resultPromise]) => {
              resultsByUrl.set(url, await resultPromise);
            })
          )
        );
      } finally {
        activeCache.releaseWaiter(waiter);
      }
    }

    return urls.map((url) => {
      const result = resultsByUrl.get(url);
      if (!result) {
        throw new Error(`Fetch returned no result for ${url}.`);
      }
      return result;
    });
  }

  function fetchInput(
    url: string,
    options?: FetchOptions
  ): Promise<FetchResult>;
  function fetchInput(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  function fetchInput(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]>;
  async function fetchInput(
    input: string | readonly string[],
    options: FetchOptions = {}
  ): Promise<FetchResult | FetchResult[]> {
    const { maxCharacters, signal } = options;
    throwIfAborted(signal);
    const maxConcurrency = options.maxConcurrency ?? defaultMaxConcurrency;

    return await observeOperation(
      observer,
      {
        inputCount: typeof input === "string" ? 1 : input.length,
        operation: "fetch",
      },
      async (operationId) => {
        assertValidMaxConcurrency(maxConcurrency);
        if (options.cache === "bypass") {
          return fetchWithoutCache(
            input,
            maxCharacters,
            maxConcurrency,
            operationId,
            signal
          );
        }
        if (typeof input === "string") {
          if (maxCharacters === undefined) {
            return fetchSingleUrlWithCache(input, operationId, true, signal);
          }

          const [result] = await fetchMultipleUrlsWithCache(
            [input],
            maxCharacters,
            maxConcurrency,
            operationId,
            signal
          );
          if (!result) {
            throw new Error("Fetch returned no result.");
          }
          return result;
        }

        return fetchMultipleUrlsWithCache(
          [...input],
          maxCharacters,
          maxConcurrency,
          operationId,
          signal
        );
      }
    );
  }

  async function fetchWithoutCache(
    input: string | readonly string[],
    maxCharacters: number | undefined,
    maxConcurrency: number,
    operationId?: string,
    signal?: AbortSignal
  ): Promise<FetchResult | FetchResult[]> {
    emitFetchCacheBypass(operationId);
    const results = await awaitAbortable(
      fetchMultipleUrls(
        typeof input === "string" ? [input] : [...input],
        maxCharacters,
        maxConcurrency,
        operationId,
        signal
      ),
      signal
    );
    if (typeof input === "string") {
      const [result] = results;
      if (!result) {
        throw new Error("Fetch returned no result.");
      }
      return result;
    }
    return results;
  }

  return {
    fetch: fetchInput,
    fetchUrl: fetchSingleUrl,
    fetchUrls: fetchMultipleUrls,
    fetchUrlsWithCache: fetchMultipleUrlsWithCache,
    fetchUrlWithCache: fetchSingleUrlWithCache,
  };
}

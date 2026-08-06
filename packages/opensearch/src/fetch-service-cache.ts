import { type resolveCacheOptions, TtlCache } from "./cache.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import { requireMaxCharacters } from "./fetch/config.ts";
import type { FetchOperations } from "./fetch/orchestration.ts";
import type { FetchResult } from "./fetch/result.ts";
import { emitCacheEvent, type OpenSearchObserver } from "./observability.ts";

export function createFetchServiceCache(
  operations: FetchOperations,
  defaultMaxConcurrency: number,
  cacheOptions: ReturnType<typeof resolveCacheOptions>,
  observer: OpenSearchObserver
) {
  const cache = cacheOptions.enabled
    ? new TtlCache<string, FetchResult>(cacheOptions.ttlMs, {
        maxEntries: cacheOptions.maxEntries,
      })
    : null;

  function fetchSingleUrl(
    url: string,
    operationId?: string
  ): Promise<FetchResult> {
    return operations.fetchUrl(url, operationId);
  }

  function fetchMultipleUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency,
    operationId?: string
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
      operationId
    );
  }

  function fetchSingleUrlWithCache(
    url: string,
    operationId?: string,
    emitCache = true
  ): Promise<FetchResult> {
    if (cache === null) {
      if (operationId && emitCache) {
        emitCacheEvent(observer, "fetch", operationId, "bypass");
      }
      return fetchSingleUrl(url, operationId);
    }

    if (operationId && emitCache) {
      emitCacheEvent(
        observer,
        "fetch",
        operationId,
        cache.has(url) ? "hit" : "miss"
      );
    }
    return cache.getOrSet(url, () => fetchSingleUrl(url, operationId));
  }

  async function fetchMultipleUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency,
    operationId?: string
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);

    if (cache === null || maxCharacters !== undefined) {
      emitFetchCacheBypass(operationId);
      return fetchMultipleUrls(
        urls,
        maxCharacters,
        maxConcurrency,
        operationId
      );
    }

    if (urls.length === 1) {
      const [url] = urls;
      return url ? [await fetchSingleUrlWithCache(url, operationId)] : [];
    }

    return fetchCachedBatch(urls, maxConcurrency, operationId, cache);
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
    activeCache: TtlCache<string, FetchResult>
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
      // Each miss joins the cache's pending map while the factories share one
      // deferred batch, so concurrent batch and single calls coalesce by URL.
      const batchUrls: string[] = [];
      let batchPromise: Promise<FetchResult[]> | undefined;
      const fetchBatchOnce = (): Promise<FetchResult[]> => {
        batchPromise ??= Promise.resolve().then(() =>
          fetchMultipleUrls(
            [...batchUrls],
            undefined,
            maxConcurrency,
            operationId
          )
        );
        return batchPromise;
      };

      // Index by the requested URL because providers may canonicalize or
      // redirect result.url while preserving request order.
      const pendingResultsByUrl = new Map<string, Promise<FetchResult>>();
      for (const url of uncachedUrls) {
        const resultPromise = activeCache.getOrSet(url, async () => {
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
        });
        pendingResultsByUrl.set(url, resultPromise);
      }

      await Promise.all(
        [...pendingResultsByUrl].map(async ([url, resultPromise]) => {
          resultsByUrl.set(url, await resultPromise);
        })
      );
    }

    return urls.map((url) => {
      const result = resultsByUrl.get(url);
      if (!result) {
        throw new Error(`Fetch returned no result for ${url}.`);
      }
      return result;
    });
  }

  return {
    emitFetchCacheBypass,
    fetchMultipleUrls,
    fetchMultipleUrlsWithCache,
    fetchSingleUrl,
    fetchSingleUrlWithCache,
  };
}

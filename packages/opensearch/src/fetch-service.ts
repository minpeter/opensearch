import { type resolveCacheOptions, TtlCache } from "./cache.ts";
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
      const fetchedResults = await fetchMultipleUrls(
        uncachedUrls,
        undefined,
        maxConcurrency,
        operationId
      );

      // Providers return results in request order; key by the requested URL
      // because a provider may canonicalize or redirect result.url.
      for (const [index, result] of fetchedResults.entries()) {
        const requestedUrl = uncachedUrls[index];
        if (requestedUrl === undefined) {
          throw new Error("Fetch returned more results than requested.");
        }
        activeCache.set(requestedUrl, result);
        resultsByUrl.set(requestedUrl, result);
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
    options: FetchOptions = {}
  ): Promise<FetchResult | FetchResult[]> {
    const { maxCharacters } = options;
    const maxConcurrency = options.maxConcurrency ?? defaultMaxConcurrency;

    return observeOperation(
      observer,
      {
        inputCount: typeof input === "string" ? 1 : input.length,
        operation: "fetch",
      },
      async (operationId) => {
        assertValidMaxConcurrency(maxConcurrency);
        if (typeof input === "string") {
          if (maxCharacters === undefined) {
            return fetchSingleUrlWithCache(input, operationId);
          }

          const [result] = await fetchMultipleUrlsWithCache(
            [input],
            maxCharacters,
            maxConcurrency,
            operationId
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
          operationId
        );
      }
    );
  }

  return {
    fetch: fetchInput,
    fetchUrl: fetchSingleUrl,
    fetchUrls: fetchMultipleUrls,
    fetchUrlsWithCache: fetchMultipleUrlsWithCache,
    fetchUrlWithCache: fetchSingleUrlWithCache,
  };
}

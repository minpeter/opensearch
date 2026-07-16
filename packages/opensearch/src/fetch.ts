import { type CacheOptions, resolveCacheOptions, TtlCache } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import {
  DEFAULT_MAX_CONCURRENCY,
  requireMaxCharacters,
} from "./fetch/config.ts";
import {
  type CreateFetchOperationsOptions,
  createFetchOperations,
  type FetchOperations,
} from "./fetch/orchestration.ts";
import {
  type FetchResult,
  fetchResultSchema as fetchResultSchemaValue,
} from "./fetch/result.ts";
import {
  createOpenSearchObserver,
  emitCacheEvent,
  type OpenSearchObserver,
  observeOperation,
} from "./observability.ts";

export type { FetchResult } from "./fetch/result.ts";

export const fetchResultSchema = fetchResultSchemaValue;

const FETCH_CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_CACHE_MAX_ENTRIES = 256;

export interface FetchOptions {
  /**
   * Maximum extracted characters returned per page. Defaults to 12,000 and is
   * enforced after every provider and fallback.
   */
  readonly maxCharacters?: number;
  /** Overrides the client's per-URL batch concurrency for this call. */
  readonly maxConcurrency?: number;
}

export interface FetchService {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  fetchUrl(url: string): Promise<FetchResult>;
  fetchUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ): Promise<FetchResult[]>;
  fetchUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ): Promise<FetchResult[]>;
  fetchUrlWithCache(url: string): Promise<FetchResult>;
}

export interface CreateFetchServiceOptions {
  readonly cache?: CacheOptions;
  readonly exaMcpFetchProvider?: CreateFetchOperationsOptions["exaMcpFetchProvider"];
  readonly localFetch?: CreateFetchOperationsOptions["localFetch"];
  readonly maxConcurrency?: number;
  readonly observer?: OpenSearchObserver;
  readonly validateUrl?: CreateFetchOperationsOptions["validateUrl"];
}

const defaultFetchService = createFetchService(processEnvironmentReader);

export function createFetchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateFetchServiceOptions = {}
): FetchService {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  assertValidMaxConcurrency(maxConcurrency);
  const observer = options.observer ?? createOpenSearchObserver();
  const cacheOptions = resolveCacheOptions(options.cache, {
    maxEntries: FETCH_CACHE_MAX_ENTRIES,
    ttlMs: FETCH_CACHE_TTL_MS,
  });
  return createFetchServiceForOperations(
    createFetchOperations(env, options),
    maxConcurrency,
    cacheOptions,
    observer
  );
}

function createFetchServiceForOperations(
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

  function fetchUrl(url: string, operationId?: string): Promise<FetchResult> {
    return operations.fetchUrl(url, operationId);
  }

  function fetchUrls(
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

  function fetchUrlWithCache(
    url: string,
    operationId?: string,
    emitCache = true
  ): Promise<FetchResult> {
    if (cache === null) {
      if (operationId && emitCache) {
        emitCacheEvent(observer, "fetch", operationId, "bypass");
      }
      return fetchUrl(url, operationId);
    }

    if (operationId && emitCache) {
      emitCacheEvent(
        observer,
        "fetch",
        operationId,
        cache.has(url) ? "hit" : "miss"
      );
    }
    return cache.getOrSet(url, () => fetchUrl(url, operationId));
  }

  async function fetchUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency,
    operationId?: string
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);

    if (cache === null || maxCharacters !== undefined) {
      emitFetchCacheBypass(operationId);
      return fetchUrls(urls, maxCharacters, maxConcurrency, operationId);
    }

    if (urls.length === 1) {
      const [url] = urls;
      return url ? [await fetchUrlWithCache(url, operationId)] : [];
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
      const fetchedResults = await fetchUrls(
        uncachedUrls,
        undefined,
        maxConcurrency,
        operationId
      );

      for (const result of fetchedResults) {
        activeCache.set(result.url, result);
        resultsByUrl.set(result.url, result);
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

  function fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  function fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  function fetch(
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
            return fetchUrlWithCache(input, operationId);
          }

          const [result] = await fetchUrlsWithCache(
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

        return fetchUrlsWithCache(
          [...input],
          maxCharacters,
          maxConcurrency,
          operationId
        );
      }
    );
  }

  return {
    fetch,
    fetchUrl,
    fetchUrls,
    fetchUrlsWithCache,
    fetchUrlWithCache,
  };
}

export function fetchUrl(url: string): Promise<FetchResult> {
  return defaultFetchService.fetchUrl(url);
}

export function fetchUrls(
  urls: string[],
  maxCharacters?: number,
  maxConcurrency?: number
): Promise<FetchResult[]> {
  return defaultFetchService.fetchUrls(urls, maxCharacters, maxConcurrency);
}

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return defaultFetchService.fetchUrlWithCache(url);
}

export function fetchUrlsWithCache(
  urls: string[],
  maxCharacters?: number,
  maxConcurrency?: number
): Promise<FetchResult[]> {
  return defaultFetchService.fetchUrlsWithCache(
    urls,
    maxCharacters,
    maxConcurrency
  );
}

export function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResult>;
export function fetch(
  urls: readonly string[],
  options?: FetchOptions
): Promise<FetchResult[]>;
export function fetch(
  input: string | readonly string[],
  options: FetchOptions = {}
): Promise<FetchResult | FetchResult[]> {
  if (typeof input === "string") {
    return defaultFetchService.fetch(input, options);
  }

  return defaultFetchService.fetch(input, options);
}

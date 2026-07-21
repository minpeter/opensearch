import pRetry from "p-retry";

import { type CacheOptions, resolveCacheOptions, TtlCache } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import {
  createOpenSearchObserver,
  emitCacheEvent,
  emitFallbackEvent,
  type OpenSearchObserver,
  observeOperation,
  observeProviderAttempt,
} from "./observability.ts";
import {
  formatFailureSummary,
  SearchEngineError,
  SearchExecutionError,
} from "./search/errors.ts";
import { getSearchProviders } from "./search/providers.ts";
import {
  SEARCH_ENGINE_NAMES as SEARCH_ENGINE_NAMES_VALUE,
  type SearchProvider,
  type SearchResult,
  searchResultSchema as searchResultSchemaValue,
  searchResultsSchema as searchResultsSchemaValue,
} from "./search/types.ts";

export const SEARCH_ENGINE_NAMES = SEARCH_ENGINE_NAMES_VALUE;
export const searchResultSchema = searchResultSchemaValue;
export const searchResultsSchema = searchResultsSchemaValue;

const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 256;

export interface SearchCallOptions {
  /** Skip the response cache for this call. Retry behavior is unchanged. */
  readonly cache?: "bypass";
}

export interface SearchService {
  search: (query: string, numResults?: number) => Promise<SearchResult[]>;
  searchStream: (
    query: string,
    numResults?: number
  ) => AsyncGenerator<SearchResult[], void, undefined>;
  searchWithRetryAndCache: (
    query: string,
    maxResults?: number,
    options?: SearchCallOptions
  ) => Promise<SearchResult[]>;
}

export interface CreateSearchServiceOptions {
  readonly cache?: CacheOptions;
  readonly observer?: OpenSearchObserver;
  readonly providers?: (env: EnvironmentReader) => SearchProvider[];
}

const defaultSearchService = createSearchService(processEnvironmentReader);

export function createSearchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateSearchServiceOptions = {}
): SearchService {
  const resolveProviders = options.providers ?? getSearchProviders;
  const observer = options.observer ?? createOpenSearchObserver();
  const cacheOptions = resolveCacheOptions(options.cache, {
    maxEntries: SEARCH_CACHE_MAX_ENTRIES,
    ttlMs: SEARCH_CACHE_TTL_MS,
  });
  const searchCache = cacheOptions.enabled
    ? new TtlCache<string, SearchResult[]>(cacheOptions.ttlMs, {
        maxEntries: cacheOptions.maxEntries,
      })
    : null;
  const configuredProviders =
    env === processEnvironmentReader ? null : resolveProviders(env);

  async function runProviders(
    query: string,
    numResults: number,
    operationId: string
  ): Promise<SearchResult[]> {
    const failures: SearchEngineError[] = [];

    const providers = configuredProviders ?? resolveProviders(env);

    for (const [index, provider] of providers.entries()) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: providers are tried sequentially according to fallback priority
        const results = await observeProviderAttempt(
          observer,
          {
            operation: "search",
            operationId,
            provider: provider.name,
          },
          () => provider.search(query, numResults)
        );
        return results.slice(0, numResults);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          if (error.status === 451) {
            throw error;
          }
          failures.push(error);
          const nextProvider = providers[index + 1];
          if (nextProvider) {
            emitFallbackEvent(observer, {
              fromProvider: provider.name,
              operation: "search",
              operationId,
              reason: error.kind,
              toProvider: nextProvider.name,
            });
          }
          continue;
        }

        throw error;
      }
    }

    throw createSearchExecutionError(failures);
  }

  function searchOnce(query: string, numResults = 10): Promise<SearchResult[]> {
    return observeOperation(
      observer,
      { inputCount: 1, operation: "search" },
      (operationId) => {
        emitCacheEvent(observer, "search", operationId, "bypass");
        return runProviders(query, numResults, operationId);
      }
    );
  }

  function searchWithCache(
    query: string,
    maxResults = 10,
    callOptions: SearchCallOptions = {}
  ): Promise<SearchResult[]> {
    return observeOperation(
      observer,
      { inputCount: 1, operation: "search" },
      async (operationId) => {
        const cacheKey = createSearchCacheKey(query, maxResults);
        const execute = async () =>
          pRetry(async () => runProviders(query, maxResults, operationId), {
            factor: 2,
            minTimeout: 2000,
            retries: 2,
            shouldRetry: ({ error }) => shouldRetrySearchError(error),
          });
        if (searchCache === null || callOptions.cache === "bypass") {
          emitCacheEvent(observer, "search", operationId, "bypass");
          return (await execute()).slice(0, maxResults);
        }

        emitCacheEvent(
          observer,
          "search",
          operationId,
          searchCache.has(cacheKey) ? "hit" : "miss"
        );
        const results = await searchCache.getOrSet(cacheKey, execute);
        return results.slice(0, maxResults);
      }
    );
  }

  async function* searchStreamImpl(
    query: string,
    numResults = 10
  ): AsyncGenerator<SearchResult[], void, undefined> {
    const providers = configuredProviders ?? resolveProviders(env);
    const operationId = observer.createOperationId("search");
    const failures: SearchEngineError[] = [];

    const pending = providers.map((provider) => ({
      attempt: observeProviderAttempt(
        observer,
        { operation: "search", operationId, provider: provider.name },
        async () => {
          try {
            const results = await provider.search(query, numResults);
            return results.slice(0, numResults);
          } catch (error) {
            if (error instanceof SearchEngineError) {
              failures.push(error);
            } else {
              failures.push(
                new SearchEngineError(
                  provider.name,
                  "transient",
                  `${provider.name} search failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                )
              );
            }
            return null;
          }
        }
      ),
    }));

    let delivered = 0;
    const queue = [...pending];
    while (queue.length > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: results are yielded in completion order, so each provider's settlement is awaited one at a time
      const settled = await Promise.race(
        queue.map((entry) =>
          entry.attempt.then((results) => ({ entry, results }))
        )
      );
      queue.splice(queue.indexOf(settled.entry), 1);
      if (settled.results !== null && settled.results.length > 0) {
        delivered += 1;
        yield settled.results;
      }
    }

    if (delivered === 0) {
      throw createSearchExecutionError(failures);
    }
  }

  return {
    search: searchOnce,
    searchStream: searchStreamImpl,
    searchWithRetryAndCache: searchWithCache,
  };
}

export function search(
  query: string,
  numResults = 10
): Promise<SearchResult[]> {
  return defaultSearchService.searchWithRetryAndCache(query, numResults);
}

export function searchWithRetryAndCache(
  query: string,
  maxResults = 10,
  options?: SearchCallOptions
): Promise<SearchResult[]> {
  return defaultSearchService.searchWithRetryAndCache(
    query,
    maxResults,
    options
  );
}

export function searchStream(
  query: string,
  numResults = 10
): AsyncGenerator<SearchResult[], void, undefined> {
  return defaultSearchService.searchStream(query, numResults);
}

function shouldRetrySearchError(error: Error): boolean {
  if (error instanceof SearchEngineError && error.status === 451) {
    return false;
  }
  if (error instanceof SearchExecutionError) {
    return error.retryable;
  }

  return true;
}

function createSearchCacheKey(query: string, maxResults: number): string {
  return `${query}\u0000${maxResults}`;
}

function createSearchExecutionError(
  failures: SearchEngineError[]
): SearchExecutionError {
  if (failures.every((failure) => failure.kind === "no-results")) {
    return new SearchExecutionError("No Results", false);
  }

  const failedEngines = failures.map((failure) => failure.engine).join(", ");
  const failureSummary = formatFailureSummary(failures);

  if (failures.every((failure) => failure.kind === "blocked")) {
    return new SearchExecutionError(
      `All search engines failed: ${failedEngines}${failureSummary}`,
      false
    );
  }

  if (failures.every((failure) => failure.kind !== "no-results")) {
    return new SearchExecutionError(
      `Search failed across all engines: ${failedEngines}${failureSummary}`,
      failures.every((failure) => failure.kind === "transient")
    );
  }

  return new SearchExecutionError(
    `All search engines failed: ${failedEngines}${failureSummary}`,
    false
  );
}

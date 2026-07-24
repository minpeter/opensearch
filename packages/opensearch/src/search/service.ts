import pRetry from "p-retry";

import { resolveCacheOptions, TtlCache } from "../cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createOpenSearchObserver,
  emitCacheEvent,
  observeOperation,
  observeProviderAttempt,
} from "../observability.ts";
import type {
  CreateSearchServiceOptions,
  SearchCallOptions,
  SearchService,
} from "../search.ts";
import type { SearchEngineError } from "./errors.ts";
import {
  createSearchExecutionError,
  handleSequentialProviderError,
  handleStreamProviderError,
  rethrowTerminalSearchError,
  shouldRetrySearchError,
} from "./failures.ts";
import { isNativeSearchProvider } from "./native-registry.ts";
import { getSearchProviders } from "./providers.ts";
import type { SearchProvider, SearchResult } from "./types.ts";

const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 256;

export function createSearchServiceForEnvironment(
  env: EnvironmentReader,
  options: CreateSearchServiceOptions
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
    env === processEnvironmentReader || options.refreshProviders
      ? null
      : Promise.resolve(resolveProviders(env));

  function getConfiguredProviders(): Promise<SearchProvider[]> {
    return configuredProviders ?? Promise.resolve(resolveProviders(env));
  }

  async function runProviders(
    query: string,
    numResults: number,
    operationId: string,
    providers: readonly SearchProvider[]
  ): Promise<SearchResult[]> {
    const failures: SearchEngineError[] = [];

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
        handleSequentialProviderError(
          provider,
          providers[index + 1],
          error,
          failures,
          observer,
          operationId
        );
      }
    }

    throw createSearchExecutionError(failures);
  }

  function searchOnce(query: string, numResults = 10): Promise<SearchResult[]> {
    return observeOperation(
      observer,
      { inputCount: 1, operation: "search" },
      async (operationId) => {
        emitCacheEvent(observer, "search", operationId, "bypass");
        const providers = await getConfiguredProviders();
        return runProviders(query, numResults, operationId, providers);
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
        const execute = async () => {
          try {
            const providers = await getConfiguredProviders();
            return await pRetry(
              async () =>
                runProviders(query, maxResults, operationId, providers),
              {
                factor: 2,
                minTimeout: 2000,
                retries: 2,
                shouldRetry: ({ error }) => shouldRetrySearchError(error),
              }
            );
          } catch (error) {
            rethrowTerminalSearchError(error);
          }
        };
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

  async function resolveConfiguredProviders(): Promise<SearchProvider[]> {
    try {
      return await getConfiguredProviders();
    } catch (error) {
      rethrowTerminalSearchError(error);
    }
  }

  async function* searchStreamImpl(
    query: string,
    numResults = 10
  ): AsyncGenerator<SearchResult[], void, undefined> {
    const operationId = observer.createOperationId("search");
    const startedAt = observer.now();
    const failures: SearchEngineError[] = [];
    observer.emit({
      inputCount: 1,
      operation: "search",
      operationId,
      phase: "start",
      timestampMs: startedAt,
      type: "operation",
    });

    try {
      const providers = await resolveConfiguredProviders();
      let delivered = 0;
      for await (const results of streamNativeProviderResults(
        providers,
        query,
        numResults,
        operationId,
        failures
      )) {
        delivered += 1;
        yield results;
      }
      for await (const results of streamConcurrentProviderResults(
        providers,
        query,
        numResults,
        operationId,
        failures
      )) {
        delivered += 1;
        yield results;
      }

      if (delivered === 0) {
        throw createSearchExecutionError(failures);
      }
      observer.emit({
        durationMs: observer.now() - startedAt,
        inputCount: 1,
        operation: "search",
        operationId,
        phase: "success",
        resultCount: delivered,
        timestampMs: observer.now(),
        type: "operation",
      });
    } catch (error) {
      observer.emit({
        durationMs: observer.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name }
            : { name: "UnknownError" },
        inputCount: 1,
        operation: "search",
        operationId,
        phase: "failure",
        timestampMs: observer.now(),
        type: "operation",
      });
      throw error;
    }
  }

  async function* streamNativeProviderResults(
    providers: readonly SearchProvider[],
    query: string,
    numResults: number,
    operationId: string,
    failures: SearchEngineError[]
  ): AsyncGenerator<SearchResult[], void, undefined> {
    const nativeProviders = providers.filter(isNativeSearchProvider);
    for (const provider of nativeProviders) {
      // biome-ignore lint/performance/noAwaitInLoops: native routes must settle in priority order before any fallback receives the query
      const settled = await attemptStreamProvider(
        provider,
        query,
        numResults,
        operationId,
        failures
      );
      if (settled.results !== null && settled.results.length > 0) {
        yield settled.results;
      }
    }
  }

  async function* streamConcurrentProviderResults(
    providers: readonly SearchProvider[],
    query: string,
    numResults: number,
    operationId: string,
    failures: SearchEngineError[]
  ): AsyncGenerator<SearchResult[], void, undefined> {
    const concurrentProviders = providers.filter(
      (provider) => !isNativeSearchProvider(provider)
    );
    const queue = concurrentProviders.map((provider) => ({
      attempt: attemptStreamProvider(
        provider,
        query,
        numResults,
        operationId,
        failures
      ),
      provider,
    }));
    while (queue.length > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: results are yielded in completion order, so each provider's settlement is awaited one at a time
      const settled = await Promise.race(queue.map((entry) => entry.attempt));
      queue.splice(
        queue.findIndex((entry) => entry.provider === settled.provider),
        1
      );
      if (settled.results !== null && settled.results.length > 0) {
        yield settled.results;
      }
    }
  }

  async function attemptStreamProvider(
    provider: SearchProvider,
    query: string,
    numResults: number,
    operationId: string,
    failures: SearchEngineError[]
  ): Promise<{ provider: SearchProvider; results: SearchResult[] | null }> {
    const results = await observeProviderAttempt(
      observer,
      { operation: "search", operationId, provider: provider.name },
      async () => {
        try {
          const found = await provider.search(query, numResults);
          return found.slice(0, numResults);
        } catch (error) {
          handleStreamProviderError(provider, error, failures);
          return null;
        }
      }
    );
    return { provider, results };
  }

  return {
    search: searchOnce,
    searchStream: searchStreamImpl,
    searchWithRetryAndCache: searchWithCache,
  };
}

function createSearchCacheKey(query: string, maxResults: number): string {
  return `${query}\u0000${maxResults}`;
}

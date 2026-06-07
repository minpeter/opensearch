import pRetry from "p-retry";

import { TtlCache } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import {
  formatFailureSummary,
  SearchEngineError,
  SearchExecutionError,
} from "./search/errors.ts";
import { getSearchProviders } from "./search/providers.ts";
import {
  SEARCH_ENGINE_NAMES as SEARCH_ENGINE_NAMES_VALUE,
  type SearchResult,
  searchResultSchema as searchResultSchemaValue,
  searchResultsSchema as searchResultsSchemaValue,
} from "./search/types.ts";

export const SEARCH_ENGINE_NAMES = SEARCH_ENGINE_NAMES_VALUE;
export const searchResultSchema = searchResultSchemaValue;
export const searchResultsSchema = searchResultsSchemaValue;

const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

export interface SearchService {
  search(query: string, numResults?: number): Promise<SearchResult[]>;
  searchWithRetryAndCache(
    query: string,
    maxResults?: number
  ): Promise<SearchResult[]>;
}

const defaultSearchService = createSearchService(processEnvironmentReader);

export function createSearchService(
  env: EnvironmentReader = processEnvironmentReader
): SearchService {
  const searchCache = new TtlCache<string, SearchResult[]>(SEARCH_CACHE_TTL_MS);
  const configuredProviders =
    env === processEnvironmentReader ? null : getSearchProviders(env);

  async function searchOnce(
    query: string,
    numResults = 10
  ): Promise<SearchResult[]> {
    const failures: SearchEngineError[] = [];

    const providers = configuredProviders ?? getSearchProviders(env);

    for (const provider of providers) {
      try {
        const results = await provider.search(query, numResults);
        return results.slice(0, numResults);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          failures.push(error);
          continue;
        }

        throw error;
      }
    }

    throw createSearchExecutionError(failures);
  }

  async function searchWithCache(
    query: string,
    maxResults = 10
  ): Promise<SearchResult[]> {
    const cacheKey = createSearchCacheKey(query, maxResults);

    const results = await searchCache.getOrSet(cacheKey, async () =>
      pRetry(async () => searchOnce(query, maxResults), {
        factor: 2,
        minTimeout: 2000,
        retries: 2,
        shouldRetry: ({ error }) => shouldRetrySearchError(error),
      })
    );

    return results.slice(0, maxResults);
  }

  return {
    search: searchOnce,
    searchWithRetryAndCache: searchWithCache,
  };
}

export function search(
  query: string,
  numResults = 10
): Promise<SearchResult[]> {
  return defaultSearchService.search(query, numResults);
}

export function searchWithRetryAndCache(
  query: string,
  maxResults = 10
): Promise<SearchResult[]> {
  return defaultSearchService.searchWithRetryAndCache(query, maxResults);
}

function shouldRetrySearchError(error: Error): boolean {
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

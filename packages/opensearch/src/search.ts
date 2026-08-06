import type { CacheOptions } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import type { OpenSearchObserver } from "./observability.ts";
import { createSearchServiceForEnvironment } from "./search/service.ts";
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
  readonly providers?: (
    env: EnvironmentReader
  ) => Promise<SearchProvider[]> | SearchProvider[];
  readonly refreshProviders?: boolean;
}

const defaultSearchService = createSearchService(processEnvironmentReader);

export function createSearchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateSearchServiceOptions = {}
): SearchService {
  return createSearchServiceForEnvironment(env, options);
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

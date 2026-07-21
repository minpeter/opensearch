import {
  createOpenSearchWithRuntime,
  type OpenSearchClient,
  type OpenSearchOptions,
} from "./client.ts";
import { processEnvironmentReader } from "./environment.ts";
import { exaMcpFetchProvider } from "./fetch/exa-mcp-provider.ts";
import { createLocalFetch } from "./fetch/local.ts";
import {
  createFetchService,
  type FetchOptions,
  type FetchResult,
} from "./fetch.ts";
import { createFetchUrlValidator } from "./node/network-policy.ts";
import { getNodeSearchProviders } from "./search/node-providers.ts";
import type { SearchResult } from "./search/types.ts";
import { createSearchService } from "./search.ts";

export type {
  CacheOptions,
  OpenSearchClient,
  OpenSearchEnvironment,
  OpenSearchEvent,
  OpenSearchEventSink,
  OpenSearchObservabilityOptions,
  OpenSearchOptions,
} from "./client.ts";
// biome-ignore lint/performance/noBarrelFile: this Node entrypoint intentionally mirrors the edge package surface.
export { NoFetchProviderError } from "./fetch/errors.ts";
export type { FetchOptions, FetchResult } from "./fetch.ts";
export { fetchResultSchema } from "./fetch.ts";
export {
  type ExtractMediaMetadataOptions,
  extractMediaMetadata,
  type YtDlpRunner,
} from "./node/media.ts";
export { SearchEngineError, SearchExecutionError } from "./search/errors.ts";
export type {
  EngineFailureKind,
  ParsedResult,
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "./search/types.ts";
export {
  SEARCH_ENGINE_NAMES,
  searchResultSchema,
  searchResultsSchema,
} from "./search.ts";

const nodeFetchService = createFetchService(processEnvironmentReader, {
  exaMcpFetchProvider,
  localFetch: createLocalFetch(),
  validateUrl: createFetchUrlValidator(),
});
const nodeSearchService = createSearchService(processEnvironmentReader, {
  providers: getNodeSearchProviders,
});

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
  options?: FetchOptions
): Promise<FetchResult | FetchResult[]> {
  if (typeof input === "string") {
    return nodeFetchService.fetch(input, options);
  }

  return nodeFetchService.fetch(input, options);
}

export function search(
  query: string,
  maxResults?: number
): Promise<SearchResult[]> {
  return nodeSearchService.searchWithRetryAndCache(query, maxResults);
}

export function searchStream(
  query: string,
  numResults = 10
): AsyncGenerator<SearchResult[], void, undefined> {
  return nodeSearchService.searchStream(query, numResults);
}

export function createOpenSearch(
  options: OpenSearchOptions = {}
): OpenSearchClient {
  return createOpenSearchWithRuntime(options, {
    exaMcpFetchProvider,
    fetchUrlValidatorFactory: createFetchUrlValidator,
    localFetchFactory: createLocalFetch,
    searchProviders: getNodeSearchProviders,
  });
}

import {
  createOpenSearchWithRuntime,
  type OpenSearchClient,
  type OpenSearchOptions,
} from "./client.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import { exaMcpFetchProvider } from "./fetch/exa-mcp-provider.ts";
import { fetchLocalUrl } from "./fetch/local.ts";
import {
  createFetchService,
  type FetchOptions,
  type FetchResult,
} from "./fetch.ts";
import { createDuckDuckGoProvider } from "./search/duckduckgo.ts";
import { createExaMcpSearchProvider } from "./search/providers/exa-mcp.ts";
import { createParallelMcpSearchProvider } from "./search/providers/parallel-mcp.ts";
import { getSearchProviders } from "./search/providers.ts";
import type { SearchProvider, SearchResult } from "./search/types.ts";
import { createSearchService } from "./search.ts";

// Stable surface re-exported verbatim from the edge core.
export type {
  OpenSearchClient,
  OpenSearchEnvironment,
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

function getNodeSearchProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return getSearchProviders(env, {
    duckDuckGoFactory: createDuckDuckGoProvider,
    exaMcpFactory: createExaMcpSearchProvider,
    parallelMcpFactory: createParallelMcpSearchProvider,
  });
}

const nodeFetchService = createFetchService(processEnvironmentReader, {
  exaMcpFetchProvider,
  localFetch: fetchLocalUrl,
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

export function createOpenSearch(
  options: OpenSearchOptions = {}
): OpenSearchClient {
  return createOpenSearchWithRuntime(options, {
    exaMcpFetchProvider,
    localFetch: fetchLocalUrl,
    searchProviders: getNodeSearchProviders,
  });
}

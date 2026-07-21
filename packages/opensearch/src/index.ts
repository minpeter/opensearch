export type {
  CacheOptions,
  OpenSearchClient,
  OpenSearchEnvironment,
  OpenSearchEvent,
  OpenSearchEventSink,
  OpenSearchObservabilityOptions,
  OpenSearchOptions,
} from "./client.ts";
export { createOpenSearch } from "./client.ts";
export { codeSearch } from "./code-search/service.ts";
export type {
  CodeSearchMatch,
  CodeSearchOptions,
  CodeSearchProviderName,
  CodeSearchResult,
} from "./code-search/types.ts";
export {
  CODE_SEARCH_PROVIDER_NAMES,
  codeSearchResultSchema,
  codeSearchResultsSchema,
} from "./code-search/types.ts";
export { NoFetchProviderError } from "./fetch/errors.ts";
export type { FetchOptions, FetchResult } from "./fetch.ts";
export { fetch, fetchResultSchema } from "./fetch.ts";
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
  searchStream,
  searchWithRetryAndCache as search,
} from "./search.ts";

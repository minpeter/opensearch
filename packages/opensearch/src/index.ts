export type {
  OpenSearchClient,
  OpenSearchEnvironment,
  OpenSearchOptions,
} from "./client.ts";
export { createOpenSearch } from "./client.ts";
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
  searchWithRetryAndCache as search,
} from "./search.ts";

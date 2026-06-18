import {
  createOpenSearch as createEdgeOpenSearch,
  type FetchResult,
  type OpenSearchClient,
  type OpenSearchOptions,
  type SearchResult,
} from "@minpeter/opensearch";
import {
  createOpenSearchToolsForRuntime,
  createWebFetchToolForRuntime,
  createWebSearchToolForRuntime,
  type CreateOpenSearch as SharedCreateOpenSearch,
  type OpenSearchToolRuntime as SharedOpenSearchToolRuntime,
  type OpenSearchToolSet as SharedOpenSearchToolSet,
  type OpenSearchToolsOptions as SharedOpenSearchToolsOptions,
  type WebFetchTool as SharedWebFetchTool,
  type WebSearchTool as SharedWebSearchTool,
} from "./tool-factory.ts";

export type {
  FetchResult,
  OpenSearchClient,
  OpenSearchOptions,
  SearchResult,
} from "@minpeter/opensearch";
export type { WebFetchInput, WebSearchInput } from "./tool-schemas.ts";

export type CreateOpenSearch = SharedCreateOpenSearch<
  OpenSearchClient,
  OpenSearchOptions
>;
export type OpenSearchToolRuntime = SharedOpenSearchToolRuntime<
  OpenSearchClient,
  OpenSearchOptions
>;
export type OpenSearchToolsOptions = SharedOpenSearchToolsOptions<
  OpenSearchClient,
  OpenSearchOptions
>;
export type OpenSearchToolSet = SharedOpenSearchToolSet<
  SearchResult,
  FetchResult
>;
export type WebFetchTool = SharedWebFetchTool<FetchResult>;
export type WebSearchTool = SharedWebSearchTool<SearchResult>;

const edgeRuntime: OpenSearchToolRuntime = {
  createOpenSearch: createEdgeOpenSearch,
};

export function createOpenSearchTools(
  options: OpenSearchToolsOptions = {}
): OpenSearchToolSet {
  return createOpenSearchToolsForRuntime(edgeRuntime, options);
}

export function createWebSearchTool(
  options: OpenSearchToolsOptions = {}
): WebSearchTool {
  return createWebSearchToolForRuntime(edgeRuntime, options);
}

export function createWebFetchTool(
  options: OpenSearchToolsOptions = {}
): WebFetchTool {
  return createWebFetchToolForRuntime(edgeRuntime, options);
}

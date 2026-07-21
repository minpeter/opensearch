import {
  type CodeSearchResult,
  createOpenSearch as createNodeOpenSearch,
  type FetchResult,
  type OpenSearchClient,
  type OpenSearchOptions,
  type SearchResult,
} from "@minpeter/opensearch/node";
import {
  createCodeSearchToolForRuntime,
  createOpenSearchToolsForRuntime,
  createWebFetchToolForRuntime,
  createWebSearchToolForRuntime,
  type CodeSearchTool as SharedCodeSearchTool,
  type CreateOpenSearch as SharedCreateOpenSearch,
  type OpenSearchToolRuntime as SharedOpenSearchToolRuntime,
  type OpenSearchToolSet as SharedOpenSearchToolSet,
  type OpenSearchToolsOptions as SharedOpenSearchToolsOptions,
  type WebFetchTool as SharedWebFetchTool,
  type WebSearchTool as SharedWebSearchTool,
} from "./tool-factory.ts";

export type {
  CodeSearchResult,
  FetchResult,
  OpenSearchClient,
  OpenSearchOptions,
  SearchResult,
} from "@minpeter/opensearch/node";
export type {
  CodeSearchInput,
  WebFetchInput,
  WebSearchInput,
} from "./tool-schemas.ts";
// biome-ignore lint/performance/noBarrelFile: this package entrypoint intentionally exposes the shared code-search schemas.
export {
  CODE_SEARCH_PROVIDER_NAMES,
  codeSearchInputSchema,
  codeSearchOutputSchema,
} from "./tool-schemas.ts";

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
  FetchResult,
  CodeSearchResult
>;
export type CodeSearchTool = SharedCodeSearchTool<CodeSearchResult>;
export type WebFetchTool = SharedWebFetchTool<FetchResult>;
export type WebSearchTool = SharedWebSearchTool<SearchResult>;

const nodeRuntime: OpenSearchToolRuntime = {
  createOpenSearch: createNodeOpenSearch,
};

export function createOpenSearchTools(
  options: OpenSearchToolsOptions = {}
): OpenSearchToolSet {
  return createOpenSearchToolsForRuntime(nodeRuntime, options);
}

export function createCodeSearchTool(
  options: OpenSearchToolsOptions = {}
): CodeSearchTool {
  return createCodeSearchToolForRuntime(nodeRuntime, options);
}

export function createWebSearchTool(
  options: OpenSearchToolsOptions = {}
): WebSearchTool {
  return createWebSearchToolForRuntime(nodeRuntime, options);
}

export function createWebFetchTool(
  options: OpenSearchToolsOptions = {}
): WebFetchTool {
  return createWebFetchToolForRuntime(nodeRuntime, options);
}

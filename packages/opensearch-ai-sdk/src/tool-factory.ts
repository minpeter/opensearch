import type { ToolExecutionOptions } from "ai";
import {
  DEFAULT_SEARCH_RESULT_COUNT,
  type WebFetchInput,
  type WebFetchResult,
  type WebSearchInput,
  type WebSearchResult,
  webFetchInputSchema,
  webFetchOutputSchema,
  webSearchInputSchema,
  webSearchOutputSchema,
} from "./tool-schemas.ts";

export interface OpenSearchFetchOptions {
  readonly maxCharacters?: number;
}

export interface OpenSearchClientLike<
  TSearchResult extends WebSearchResult = WebSearchResult,
  TFetchResult extends WebFetchResult = WebFetchResult,
> {
  fetch: ((
    url: string,
    options?: OpenSearchFetchOptions
  ) => Promise<TFetchResult>) &
    ((
      urls: readonly string[],
      options?: OpenSearchFetchOptions
    ) => Promise<TFetchResult[]>);
  search: (query: string, maxResults?: number) => Promise<TSearchResult[]>;
}

export interface OpenSearchToolsOptions<
  TClient extends OpenSearchClientLike = OpenSearchClientLike,
  TOpenSearchOptions = unknown,
> {
  readonly client?: TClient;
  readonly openSearchOptions?: TOpenSearchOptions;
}

export type CreateOpenSearch<
  TClient extends OpenSearchClientLike = OpenSearchClientLike,
  TOpenSearchOptions = unknown,
> = (options?: TOpenSearchOptions) => TClient;

export interface OpenSearchToolRuntime<
  TClient extends OpenSearchClientLike = OpenSearchClientLike,
  TOpenSearchOptions = unknown,
> {
  readonly createOpenSearch: CreateOpenSearch<TClient, TOpenSearchOptions>;
}

export interface WebSearchTool<
  TSearchResult extends WebSearchResult = WebSearchResult,
> {
  readonly description: string;
  execute: (
    input: WebSearchInput,
    options: ToolExecutionOptions<unknown>
  ) => Promise<TSearchResult[]>;
  readonly inputSchema: typeof webSearchInputSchema;
  readonly outputSchema: typeof webSearchOutputSchema;
}

export interface WebFetchTool<
  TFetchResult extends WebFetchResult = WebFetchResult,
> {
  readonly description: string;
  execute: (
    input: WebFetchInput,
    options: ToolExecutionOptions<unknown>
  ) => Promise<TFetchResult[]>;
  readonly inputSchema: typeof webFetchInputSchema;
  readonly outputSchema: typeof webFetchOutputSchema;
}

export interface OpenSearchToolSet<
  TSearchResult extends WebSearchResult = WebSearchResult,
  TFetchResult extends WebFetchResult = WebFetchResult,
> {
  readonly web_fetch: WebFetchTool<TFetchResult>;
  readonly web_search: WebSearchTool<TSearchResult>;
}

export const webSearchDescription = `Search the web and return ranked search results with titles, URLs, highlights, and source labels.

Use it for current facts, docs, news, people, companies, and other web questions.
Follow promising URLs with web_fetch when you need full markdown content.`;

export const webFetchDescription = `Read one or more webpages as clean markdown with source metadata.

Use it after web_search when a result needs full-page content, or call it directly with known URLs.`;

export function createOpenSearchToolsForRuntime<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TClient extends OpenSearchClientLike<TSearchResult, TFetchResult>,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions> = {}
): OpenSearchToolSet<TSearchResult, TFetchResult> {
  const client = resolveClient(runtime, options);
  // biome-ignore assist/source/useSortedKeys: Tool registration order is part of the public API.
  const tools = {
    web_search: createWebSearchToolForClient(client),
    web_fetch: createWebFetchToolForClient(client),
  } satisfies OpenSearchToolSet<TSearchResult, TFetchResult>;

  return tools;
}

export function createWebSearchToolForRuntime<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TClient extends OpenSearchClientLike<TSearchResult, TFetchResult>,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions> = {}
): WebSearchTool<TSearchResult> {
  return createWebSearchToolForClient(resolveClient(runtime, options));
}

export function createWebFetchToolForRuntime<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TClient extends OpenSearchClientLike<TSearchResult, TFetchResult>,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions> = {}
): WebFetchTool<TFetchResult> {
  return createWebFetchToolForClient(resolveClient(runtime, options));
}

function resolveClient<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TClient extends OpenSearchClientLike<TSearchResult, TFetchResult>,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions>
): TClient {
  const { client, openSearchOptions } = options;

  if (client && openSearchOptions) {
    throw new Error("Provide either client or openSearchOptions, not both.");
  }

  return client ?? runtime.createOpenSearch(openSearchOptions);
}

function createWebSearchToolForClient<TSearchResult extends WebSearchResult>(
  client: Pick<OpenSearchClientLike<TSearchResult, WebFetchResult>, "search">
): WebSearchTool<TSearchResult> {
  const toolConfig: WebSearchTool<TSearchResult> = {
    description: webSearchDescription,
    execute: async (input) =>
      client.search(input.query, getSearchResultCount(input)),
    inputSchema: webSearchInputSchema,
    outputSchema: webSearchOutputSchema,
  };

  return toolConfig;
}

function createWebFetchToolForClient<TFetchResult extends WebFetchResult>(
  client: Pick<OpenSearchClientLike<WebSearchResult, TFetchResult>, "fetch">
): WebFetchTool<TFetchResult> {
  const toolConfig: WebFetchTool<TFetchResult> = {
    description: webFetchDescription,
    execute: async (input) => client.fetch(input.urls, getFetchOptions(input)),
    inputSchema: webFetchInputSchema,
    outputSchema: webFetchOutputSchema,
  };

  return toolConfig;
}

export function getSearchResultCount(input: WebSearchInput): number {
  return input.numResults ?? DEFAULT_SEARCH_RESULT_COUNT;
}

function getFetchOptions(
  input: WebFetchInput
): OpenSearchFetchOptions | undefined {
  if (input.maxCharacters === undefined) {
    return;
  }

  return { maxCharacters: input.maxCharacters };
}

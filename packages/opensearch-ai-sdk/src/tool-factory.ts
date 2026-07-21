import type { ToolExecutionOptions } from "ai";
import {
  type CodeSearchInput,
  type CodeSearchResult,
  codeSearchInputSchema,
  codeSearchOutputSchema,
  DEFAULT_CODE_SEARCH_RESULT_COUNT,
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

type CodeSearchProviderName = NonNullable<CodeSearchInput["sources"]>[number];

export interface OpenSearchCodeSearchOptions {
  readonly language?: string;
  readonly numResults?: number;
  readonly path?: string;
  readonly repo?: string;
  readonly sources?: readonly CodeSearchProviderName[];
  readonly useRegexp?: boolean;
}

export interface OpenSearchFetchOptions {
  readonly maxCharacters?: number;
}

export interface OpenSearchClientLike<
  TSearchResult extends WebSearchResult = WebSearchResult,
  TFetchResult extends WebFetchResult = WebFetchResult,
  TCodeSearchResult extends CodeSearchResult = CodeSearchResult,
> {
  codeSearch: (
    query: string,
    options?: OpenSearchCodeSearchOptions
  ) => Promise<TCodeSearchResult[]>;
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

export interface CodeSearchTool<
  TCodeSearchResult extends CodeSearchResult = CodeSearchResult,
> {
  readonly description: string;
  execute: (
    input: CodeSearchInput,
    options: ToolExecutionOptions<unknown>
  ) => Promise<TCodeSearchResult[]>;
  readonly inputSchema: typeof codeSearchInputSchema;
  readonly outputSchema: typeof codeSearchOutputSchema;
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
  TCodeSearchResult extends CodeSearchResult = CodeSearchResult,
> {
  readonly code_search: CodeSearchTool<TCodeSearchResult>;
  readonly web_fetch: WebFetchTool<TFetchResult>;
  readonly web_search: WebSearchTool<TSearchResult>;
}

export const codeSearchDescription = `Search public source code and code documentation for real implementations, symbols, repository paths, line-numbered snippets, and code patterns.

Prefer it over web_search when the answer should come from source code. Narrow results by repository, path, language, regular expression, or provider.`;

export const webSearchDescription = `Search the web and return ranked search results with titles, URLs, highlights, and source labels.

Use it for current facts, docs, news, people, companies, and other web questions.
Follow promising URLs with web_fetch when you need full markdown content.`;

export const webFetchDescription = `Read one or more webpages as clean markdown with source metadata.

Use it after web_search when a result needs full-page content, or call it directly with known URLs.`;

export function createOpenSearchToolsForRuntime<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TCodeSearchResult extends CodeSearchResult,
  TClient extends OpenSearchClientLike<
    TSearchResult,
    TFetchResult,
    TCodeSearchResult
  >,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions> = {}
): OpenSearchToolSet<TSearchResult, TFetchResult, TCodeSearchResult> {
  const client = resolveClient(runtime, options);
  // biome-ignore assist/source/useSortedKeys: Tool registration order is part of the public API.
  const tools = {
    web_search: createWebSearchToolForClient(client),
    web_fetch: createWebFetchToolForClient(client),
    code_search: createCodeSearchToolForClient(client),
  } satisfies OpenSearchToolSet<TSearchResult, TFetchResult, TCodeSearchResult>;

  return tools;
}

export function createCodeSearchToolForRuntime<
  TSearchResult extends WebSearchResult,
  TFetchResult extends WebFetchResult,
  TCodeSearchResult extends CodeSearchResult,
  TClient extends OpenSearchClientLike<
    TSearchResult,
    TFetchResult,
    TCodeSearchResult
  >,
  TOpenSearchOptions,
>(
  runtime: OpenSearchToolRuntime<TClient, TOpenSearchOptions>,
  options: OpenSearchToolsOptions<TClient, TOpenSearchOptions> = {}
): CodeSearchTool<TCodeSearchResult> {
  return createCodeSearchToolForClient(resolveClient(runtime, options));
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

function createCodeSearchToolForClient<
  TCodeSearchResult extends CodeSearchResult,
>(
  client: Pick<
    OpenSearchClientLike<WebSearchResult, WebFetchResult, TCodeSearchResult>,
    "codeSearch"
  >
): CodeSearchTool<TCodeSearchResult> {
  return {
    description: codeSearchDescription,
    execute: async (input) =>
      client.codeSearch(input.query, getCodeSearchOptions(input)),
    inputSchema: codeSearchInputSchema,
    outputSchema: codeSearchOutputSchema,
  };
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

export function getCodeSearchOptions(
  input: CodeSearchInput
): OpenSearchCodeSearchOptions {
  return {
    ...(input.language ? { language: input.language } : {}),
    numResults: input.numResults ?? DEFAULT_CODE_SEARCH_RESULT_COUNT,
    ...(input.path ? { path: input.path } : {}),
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.sources ? { sources: input.sources } : {}),
    ...(input.useRegexp === undefined ? {} : { useRegexp: input.useRegexp }),
  };
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

import type {
  CodeSearchInput,
  CodeSearchResult,
  WebFetchResult,
  WebSearchResult,
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

interface ClientResolutionOptions<TClient, TOpenSearchOptions> {
  readonly client?: TClient;
  readonly openSearchOptions?: TOpenSearchOptions;
}

interface ClientResolutionRuntime<TClient, TOpenSearchOptions> {
  readonly createOpenSearch: (options?: TOpenSearchOptions) => TClient;
}

export function resolveClient<TClient, TOpenSearchOptions>(
  runtime: ClientResolutionRuntime<TClient, TOpenSearchOptions>,
  options: ClientResolutionOptions<TClient, TOpenSearchOptions>
): TClient {
  const { client, openSearchOptions } = options;

  if (client && openSearchOptions) {
    throw new Error("Provide either client or openSearchOptions, not both.");
  }

  return client ?? runtime.createOpenSearch(openSearchOptions);
}

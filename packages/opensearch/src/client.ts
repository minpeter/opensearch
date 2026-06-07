import {
  createEnvironmentReader,
  type OpenSearchEnvironment,
} from "./environment.ts";
import {
  createFetchService,
  type FetchOptions,
  type FetchResult,
  type FetchService,
} from "./fetch.ts";
import type { SearchResult } from "./search/types.ts";
import { createSearchService, type SearchService } from "./search.ts";

export type { OpenSearchEnvironment } from "./environment.ts";

export interface OpenSearchOptions {
  readonly env?: OpenSearchEnvironment;
}

export interface OpenSearchClient {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

class ConfiguredOpenSearchClient implements OpenSearchClient {
  readonly #fetchService: FetchService;
  readonly #searchService: SearchService;

  constructor(options: OpenSearchOptions) {
    const env = createEnvironmentReader(options.env);
    this.#fetchService = createFetchService(env);
    this.#searchService = createSearchService(env);
  }

  search(query: string, maxResults?: number): Promise<SearchResult[]> {
    return this.#searchService.searchWithRetryAndCache(query, maxResults);
  }

  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  fetch(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]> {
    if (typeof input === "string") {
      return this.#fetchService.fetch(input, options);
    }

    return this.#fetchService.fetch(input, options);
  }
}

export function createOpenSearch(
  options: OpenSearchOptions = {}
): OpenSearchClient {
  return new ConfiguredOpenSearchClient(options);
}

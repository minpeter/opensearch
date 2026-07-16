import {
  createEnvironmentReader,
  type OpenSearchEnvironment,
} from "./environment.ts";
import {
  type CreateFetchServiceOptions,
  createFetchService,
  type FetchOptions,
  type FetchResult,
  type FetchService,
} from "./fetch.ts";
import type { SearchResult } from "./search/types.ts";
import {
  type CreateSearchServiceOptions,
  createSearchService,
  type SearchService,
} from "./search.ts";

export type { OpenSearchEnvironment } from "./environment.ts";

export interface OpenSearchOptions {
  readonly env?: OpenSearchEnvironment;
  readonly fetch?: {
    /**
     * Maximum per-URL fetch work started concurrently inside a batch.
     * Defaults to 8.
     */
    readonly maxConcurrency?: number;
  };
}

/**
 * Internal runtime seams — not part of the public surface. The
 * @minpeter/opensearch/node entry injects the Node-only local fetch pipeline
 * and the DuckDuckGo-inclusive provider list here; the edge entry passes none.
 */
export interface OpenSearchRuntime {
  readonly exaMcpFetchProvider?: CreateFetchServiceOptions["exaMcpFetchProvider"];
  readonly localFetch?: CreateFetchServiceOptions["localFetch"];
  readonly searchProviders?: CreateSearchServiceOptions["providers"];
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

  constructor(options: OpenSearchOptions, runtime: OpenSearchRuntime) {
    const env = createEnvironmentReader(options.env);
    this.#fetchService = createFetchService(env, {
      exaMcpFetchProvider: runtime.exaMcpFetchProvider,
      localFetch: runtime.localFetch,
      maxConcurrency: options.fetch?.maxConcurrency,
    });
    this.#searchService = createSearchService(env, {
      providers: runtime.searchProviders,
    });
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
  return new ConfiguredOpenSearchClient(options, {});
}

/**
 * Builds a client with Node-only runtime seams injected. Used by
 * @minpeter/opensearch/node; not exported from the edge entry.
 */
export function createOpenSearchWithRuntime(
  options: OpenSearchOptions,
  runtime: OpenSearchRuntime
): OpenSearchClient {
  return new ConfiguredOpenSearchClient(options, runtime);
}

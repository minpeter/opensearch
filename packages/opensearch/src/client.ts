import type { CacheOptions } from "./cache.ts";
import {
  createEnvironmentReader,
  type OpenSearchEnvironment,
} from "./environment.ts";
import type { LocalFetchOptions } from "./fetch/local-options.ts";
import type { FetchUrlValidator } from "./fetch/orchestration.ts";
import {
  type CreateFetchServiceOptions,
  createFetchService,
  type FetchOptions,
  type FetchResult,
  type FetchService,
} from "./fetch.ts";
import {
  createOpenSearchObserver,
  type OpenSearchObservabilityOptions,
} from "./observability.ts";
import type { SearchResult } from "./search/types.ts";
import {
  type CreateSearchServiceOptions,
  createSearchService,
  type SearchCallOptions,
  type SearchService,
} from "./search.ts";

export type { CacheOptions } from "./cache.ts";
export type { OpenSearchEnvironment } from "./environment.ts";
export type {
  OpenSearchEvent,
  OpenSearchEventSink,
  OpenSearchObservabilityOptions,
} from "./observability.ts";

export interface OpenSearchOptions {
  readonly env?: OpenSearchEnvironment;
  readonly fetch?: {
    /** Allow Node local fetches to reach private networks. Defaults to false. */
    readonly allowPrivateNetwork?: boolean;
    /** Per-client fetch cache policy. */
    readonly cache?: CacheOptions;
    /**
     * Maximum per-URL fetch work started concurrently inside a batch.
     * Defaults to 8.
     */
    readonly maxConcurrency?: number;
    /** Maximum bytes downloaded by one Node local fetch. Defaults to 10 MiB. */
    readonly maxDownloadBytes?: number;
    /** Maximum redirects followed by one Node local fetch. Defaults to 5. */
    readonly maxRedirects?: number;
  };
  readonly observability?: OpenSearchObservabilityOptions;
  readonly search?: {
    /** Per-client search cache policy. */
    readonly cache?: CacheOptions;
  };
}

/**
 * Internal runtime seams — not part of the public surface. The
 * @minpeter/opensearch/node entry injects the Node-only local fetch pipeline
 * and the DuckDuckGo-inclusive provider list here; the edge entry passes none.
 */
export interface OpenSearchRuntime {
  readonly exaMcpFetchProvider?: CreateFetchServiceOptions["exaMcpFetchProvider"];
  readonly fetchUrlValidatorFactory?: (
    options: LocalFetchOptions
  ) => FetchUrlValidator;
  readonly localFetch?: CreateFetchServiceOptions["localFetch"];
  readonly localFetchFactory?: (
    options: LocalFetchOptions
  ) => NonNullable<CreateFetchServiceOptions["localFetch"]>;
  readonly searchProviders?: CreateSearchServiceOptions["providers"];
}

export interface OpenSearchClient {
  fetch: ((url: string, options?: FetchOptions) => Promise<FetchResult>) &
    ((
      urls: readonly string[],
      options?: FetchOptions
    ) => Promise<FetchResult[]>) &
    ((
      input: string | readonly string[],
      options?: FetchOptions
    ) => Promise<FetchResult | FetchResult[]>);
  search: (
    query: string,
    maxResults?: number,
    options?: SearchCallOptions
  ) => Promise<SearchResult[]>;
  searchStream: (
    query: string,
    numResults?: number
  ) => AsyncGenerator<SearchResult[], void, undefined>;
}

class ConfiguredOpenSearchClient implements OpenSearchClient {
  readonly #fetchService: FetchService;
  readonly #searchService: SearchService;

  constructor(options: OpenSearchOptions, runtime: OpenSearchRuntime) {
    const env = createEnvironmentReader(options.env);
    const observer = createOpenSearchObserver(options.observability?.onEvent);
    const localFetchOptions = {
      allowPrivateNetwork: options.fetch?.allowPrivateNetwork,
      maxDownloadBytes: options.fetch?.maxDownloadBytes,
      maxRedirects: options.fetch?.maxRedirects,
    } satisfies LocalFetchOptions;
    const localFetch = runtime.localFetchFactory?.(localFetchOptions);
    this.#fetchService = createFetchService(env, {
      cache: options.fetch?.cache,
      exaMcpFetchProvider: runtime.exaMcpFetchProvider,
      localFetch: localFetch ?? runtime.localFetch,
      maxConcurrency: options.fetch?.maxConcurrency,
      observer,
      validateUrl: runtime.fetchUrlValidatorFactory?.(localFetchOptions),
    });
    this.#searchService = createSearchService(env, {
      cache: options.search?.cache,
      observer,
      providers: runtime.searchProviders,
    });
  }

  search(
    query: string,
    maxResults?: number,
    options?: SearchCallOptions
  ): Promise<SearchResult[]> {
    return this.#searchService.searchWithRetryAndCache(
      query,
      maxResults,
      options
    );
  }

  searchStream(
    query: string,
    numResults?: number
  ): AsyncGenerator<SearchResult[], void, undefined> {
    return this.#searchService.searchStream(query, numResults);
  }

  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  fetch(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]>;
  fetch(
    input: string | readonly string[],
    options: FetchOptions = {}
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

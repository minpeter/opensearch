import { type CacheOptions, resolveCacheOptions } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import { DEFAULT_MAX_CONCURRENCY } from "./fetch/config.ts";
import {
  type CreateFetchOperationsOptions,
  createFetchOperations,
} from "./fetch/orchestration.ts";
import {
  type FetchResult,
  fetchResultSchema as fetchResultSchemaValue,
} from "./fetch/result.ts";
import { createFetchServiceForOperations } from "./fetch-service.ts";
import {
  createOpenSearchObserver,
  type OpenSearchObserver,
} from "./observability.ts";

export type { FetchResult } from "./fetch/result.ts";

export const fetchResultSchema = fetchResultSchemaValue;

const FETCH_CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_CACHE_MAX_ENTRIES = 256;

export interface FetchOptions {
  /** Skip the response cache for this call. */
  readonly cache?: "bypass";
  /**
   * Maximum extracted characters returned per page. Defaults to 12,000 and is
   * enforced after every provider and fallback.
   */
  readonly maxCharacters?: number;
  /** Overrides the client's per-URL batch concurrency for this call. */
  readonly maxConcurrency?: number;
}

export interface FetchService {
  fetch: ((url: string, options?: FetchOptions) => Promise<FetchResult>) &
    ((
      urls: readonly string[],
      options?: FetchOptions
    ) => Promise<FetchResult[]>) &
    ((
      input: string | readonly string[],
      options?: FetchOptions
    ) => Promise<FetchResult | FetchResult[]>);
  fetchUrl: (url: string) => Promise<FetchResult>;
  fetchUrls: (
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ) => Promise<FetchResult[]>;
  fetchUrlsWithCache: (
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ) => Promise<FetchResult[]>;
  fetchUrlWithCache: (url: string) => Promise<FetchResult>;
}

export interface CreateFetchServiceOptions {
  readonly cache?: CacheOptions;
  readonly exaMcpFetchProvider?: CreateFetchOperationsOptions["exaMcpFetchProvider"];
  readonly localFetch?: CreateFetchOperationsOptions["localFetch"];
  readonly maxConcurrency?: number;
  readonly observer?: OpenSearchObserver;
  readonly validateUrl?: CreateFetchOperationsOptions["validateUrl"];
}

const defaultFetchService = createFetchService(processEnvironmentReader);

export function createFetchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateFetchServiceOptions = {}
): FetchService {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  assertValidMaxConcurrency(maxConcurrency);
  const observer = options.observer ?? createOpenSearchObserver();
  const cacheOptions = resolveCacheOptions(options.cache, {
    maxEntries: FETCH_CACHE_MAX_ENTRIES,
    ttlMs: FETCH_CACHE_TTL_MS,
  });
  return createFetchServiceForOperations(
    createFetchOperations(env, options),
    maxConcurrency,
    cacheOptions,
    observer
  );
}

export function fetchUrl(url: string): Promise<FetchResult> {
  return defaultFetchService.fetchUrl(url);
}

export function fetchUrls(
  urls: string[],
  maxCharacters?: number,
  maxConcurrency?: number
): Promise<FetchResult[]> {
  return defaultFetchService.fetchUrls(urls, maxCharacters, maxConcurrency);
}

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return defaultFetchService.fetchUrlWithCache(url);
}

export function fetchUrlsWithCache(
  urls: string[],
  maxCharacters?: number,
  maxConcurrency?: number
): Promise<FetchResult[]> {
  return defaultFetchService.fetchUrlsWithCache(
    urls,
    maxCharacters,
    maxConcurrency
  );
}

export function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResult>;
export function fetch(
  urls: readonly string[],
  options?: FetchOptions
): Promise<FetchResult[]>;
export function fetch(
  input: string | readonly string[],
  options: FetchOptions = {}
): Promise<FetchResult | FetchResult[]> {
  if (typeof input === "string") {
    return defaultFetchService.fetch(input, options);
  }

  return defaultFetchService.fetch(input, options);
}

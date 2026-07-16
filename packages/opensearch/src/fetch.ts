import { TtlCache } from "./cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import { DEFAULT_MAX_CONCURRENCY } from "./fetch/config.ts";
import {
  type CreateFetchOperationsOptions,
  createFetchOperations,
  type FetchOperations,
} from "./fetch/orchestration.ts";
import {
  type FetchResult,
  fetchResultSchema as fetchResultSchemaValue,
} from "./fetch/result.ts";

export type { FetchResult } from "./fetch/result.ts";

export const fetchResultSchema = fetchResultSchemaValue;

export interface FetchOptions {
  readonly maxCharacters?: number;
  /** Overrides the client's per-URL batch concurrency for this call. */
  readonly maxConcurrency?: number;
}

export interface FetchService {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  fetchUrl(url: string): Promise<FetchResult>;
  fetchUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ): Promise<FetchResult[]>;
  fetchUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ): Promise<FetchResult[]>;
  fetchUrlWithCache(url: string): Promise<FetchResult>;
}

export interface CreateFetchServiceOptions {
  readonly exaMcpFetchProvider?: CreateFetchOperationsOptions["exaMcpFetchProvider"];
  readonly localFetch?: CreateFetchOperationsOptions["localFetch"];
  readonly maxConcurrency?: number;
}

const defaultFetchService = createFetchService(processEnvironmentReader);

export function createFetchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateFetchServiceOptions = {}
): FetchService {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  assertValidMaxConcurrency(maxConcurrency);
  return createFetchServiceForOperations(
    createFetchOperations(env, options),
    maxConcurrency
  );
}

function createFetchServiceForOperations(
  operations: FetchOperations,
  defaultMaxConcurrency: number
): FetchService {
  const cache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

  function fetchUrl(url: string): Promise<FetchResult> {
    return operations.fetchUrl(url);
  }

  function fetchUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);
    return operations.fetchUrls(urls, maxCharacters, maxConcurrency);
  }

  function fetchUrlWithCache(url: string): Promise<FetchResult> {
    return cache.getOrSet(url, () => fetchUrl(url));
  }

  async function fetchUrlsWithCache(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency = defaultMaxConcurrency
  ): Promise<FetchResult[]> {
    assertValidMaxConcurrency(maxConcurrency);

    if (urls.length === 1 && maxCharacters === undefined) {
      const [url] = urls;
      return url ? [await fetchUrlWithCache(url)] : [];
    }

    if (maxCharacters !== undefined) {
      return fetchUrls(urls, maxCharacters, maxConcurrency);
    }

    const uncachedUrls = urls.filter((url) => !cache.has(url));

    if (uncachedUrls.length > 0) {
      const fetchedResults = await fetchUrls(
        uncachedUrls,
        undefined,
        maxConcurrency
      );

      for (const result of fetchedResults) {
        cache.set(result.url, result);
      }
    }

    return Promise.all(urls.map((url) => fetchUrlWithCache(url)));
  }

  function fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  function fetch(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  async function fetch(
    input: string | readonly string[],
    options: FetchOptions = {}
  ): Promise<FetchResult | FetchResult[]> {
    const { maxCharacters } = options;
    const maxConcurrency = options.maxConcurrency ?? defaultMaxConcurrency;
    assertValidMaxConcurrency(maxConcurrency);

    if (typeof input === "string") {
      if (maxCharacters === undefined) {
        return fetchUrlWithCache(input);
      }

      const [result] = await fetchUrlsWithCache(
        [input],
        maxCharacters,
        maxConcurrency
      );
      if (!result) {
        throw new Error("Fetch returned no result.");
      }
      return result;
    }

    return fetchUrlsWithCache([...input], maxCharacters, maxConcurrency);
  }

  return {
    fetch,
    fetchUrl,
    fetchUrls,
    fetchUrlsWithCache,
    fetchUrlWithCache,
  };
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

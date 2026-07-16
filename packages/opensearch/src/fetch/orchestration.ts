import { createApiKeyPool } from "../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { createTinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_MAX_CONCURRENCY,
  EXA_API_KEY_ENV,
} from "./config.ts";
import {
  type ExaMcpFetchProvider,
  type FetchPipelineContext,
  fetchUrlsViaProviders,
  fetchUrlViaProviders,
  type LocalFetch,
} from "./provider-fallback.ts";
import { fetchViaPublicApi } from "./public-api.ts";
import type { FetchResult } from "./result.ts";

export type { ExaMcpFetchProvider, LocalFetch } from "./provider-fallback.ts";

export interface FetchOperations {
  fetchUrl(url: string): Promise<FetchResult>;
  fetchUrls(
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number
  ): Promise<FetchResult[]>;
}

export interface CreateFetchOperationsOptions {
  readonly exaMcpFetchProvider?: ExaMcpFetchProvider;
  /**
   * Terminal local page-fetch fallback (jsdom/readability/turndown/unpdf). The
   * edge build leaves this undefined so the entry never reaches Node-only deps;
   * the @minpeter/opensearch/node entry injects the real pipeline.
   */
  readonly localFetch?: LocalFetch;
}

const defaultFetchOperations = createFetchOperations(processEnvironmentReader);

export function createFetchOperations(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateFetchOperationsOptions = {}
): FetchOperations {
  const context: FetchPipelineContext = {
    exaApiKeyPool: createApiKeyPool(EXA_API_KEY_ENV, env),
    exaMcpFetchProvider: options.exaMcpFetchProvider,
    env,
    localFetch: options.localFetch,
    tinyFishApiKeyPool: createTinyFishApiKeyPool(env),
  };

  return {
    fetchUrl(url: string) {
      return fetchUrlDirect(url, context);
    },
    fetchUrls(
      urls: string[],
      maxCharacters = DEFAULT_MAX_CHARACTERS,
      maxConcurrency = DEFAULT_MAX_CONCURRENCY
    ) {
      return fetchUrlsDirect(urls, maxCharacters, maxConcurrency, context);
    },
  };
}

export function fetchUrl(url: string): Promise<FetchResult> {
  return defaultFetchOperations.fetchUrl(url);
}

async function fetchUrlDirect(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  // Phase 0: official keyless APIs for platforms generic fetch handles poorly
  // (matches only specific URLs; non-matching URLs cost nothing).
  const apiResult = await fetchViaPublicApi(url);
  if (apiResult) {
    return apiResult;
  }
  return fetchUrlViaProviders(url, context);
}

export function fetchUrls(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY
): Promise<FetchResult[]> {
  return defaultFetchOperations.fetchUrls(urls, maxCharacters, maxConcurrency);
}

async function fetchUrlsDirect(
  urls: string[],
  maxCharacters: number,
  maxConcurrency: number,
  context: FetchPipelineContext
): Promise<FetchResult[]> {
  if (urls.length === 0) {
    return [];
  }

  const uniqueUrls = [...new Set(urls)];
  const uniqueResults = await fetchUniqueUrlsDirect(
    uniqueUrls,
    maxCharacters,
    maxConcurrency,
    context
  );
  const resultsByUrl = new Map<string, FetchResult>();

  for (const [index, url] of uniqueUrls.entries()) {
    const result = uniqueResults[index];
    if (!result) {
      throw new Error(`Fetch returned no result for input at index ${index}.`);
    }
    resultsByUrl.set(url, result);
  }

  return urls.map((url, index) => {
    const result = resultsByUrl.get(url);
    if (!result) {
      throw new Error(`Fetch result mapping failed at input index ${index}.`);
    }
    return result;
  });
}

async function fetchUniqueUrlsDirect(
  urls: string[],
  maxCharacters: number,
  maxConcurrency: number,
  context: FetchPipelineContext
): Promise<FetchResult[]> {
  // Phase 0 (parity with single fetch): route official-API URLs first, send the
  // rest through the provider batch, then reassemble in the original order.
  const apiResults = await mapWithConcurrency(urls, maxConcurrency, (url) =>
    fetchViaPublicApi(url)
  );
  const remaining = urls.filter((_url, index) => apiResults[index] === null);
  if (remaining.length === urls.length) {
    return fetchUrlsViaProviders(urls, maxCharacters, context, maxConcurrency);
  }

  const remainingResults =
    remaining.length > 0
      ? await fetchUrlsViaProviders(
          remaining,
          maxCharacters,
          context,
          maxConcurrency
        )
      : [];
  const merged: FetchResult[] = [];
  let cursor = 0;
  for (const api of apiResults) {
    if (api) {
      merged.push(api);
      continue;
    }
    const next = remainingResults[cursor];
    cursor += 1;
    if (next) {
      merged.push(next);
    }
  }
  return merged;
}

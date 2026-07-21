import { createApiKeyPool } from "../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createOpenSearchObserver,
  emitFallbackEvent,
  type OpenSearchObserver,
  observeProviderAttempt,
} from "../observability.ts";
import { createTinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_MAX_CONCURRENCY,
  EXA_API_KEY_ENV,
  requireMaxCharacters,
} from "./config.ts";
import { fetchUrlsViaProviders } from "./provider-chain-batch.ts";
import { fetchUrlViaProviders } from "./provider-chain-single.ts";
import {
  type ExaMcpFetchProvider,
  type FetchPipelineContext,
  type FetchUrlValidator,
  getFirstFetchProviderName,
  type LocalFetch,
} from "./provider-context.ts";
import { fetchViaPublicApi } from "./public-api.ts";
import { type FetchResult, limitFetchResult } from "./result.ts";
import { assertProviderSafeUrl } from "./url-policy.ts";

export type {
  ExaMcpFetchProvider,
  FetchUrlValidator,
  LocalFetch,
} from "./provider-context.ts";

export interface FetchOperations {
  fetchUrl: (url: string, operationId?: string) => Promise<FetchResult>;
  fetchUrls: (
    urls: string[],
    maxCharacters?: number,
    maxConcurrency?: number,
    operationId?: string
  ) => Promise<FetchResult[]>;
}

export interface CreateFetchOperationsOptions {
  readonly exaMcpFetchProvider?: ExaMcpFetchProvider;
  /**
   * Terminal local page-fetch fallback (jsdom/readability/turndown/unpdf). The
   * edge build leaves this undefined so the entry never reaches Node-only deps;
   * the @minpeter/opensearch/node entry injects the real pipeline.
   */
  readonly localFetch?: LocalFetch;
  readonly observer?: OpenSearchObserver;
  /** Optional runtime policy evaluated before any public API or provider call. */
  readonly validateUrl?: FetchUrlValidator;
}

const defaultFetchOperations = createFetchOperations(processEnvironmentReader);

export function createFetchOperations(
  env: EnvironmentReader = processEnvironmentReader,
  options: CreateFetchOperationsOptions = {}
): FetchOperations {
  const observer = options.observer ?? createOpenSearchObserver();
  const context: FetchPipelineContext = {
    env,
    exaApiKeyPool: createApiKeyPool(EXA_API_KEY_ENV, env),
    exaMcpFetchProvider: options.exaMcpFetchProvider,
    localFetch: options.localFetch,
    observer,
    tinyFishApiKeyPool: createTinyFishApiKeyPool(env),
    validateUrl: options.validateUrl,
  };

  return {
    async fetchUrl(url: string, operationId) {
      const result = await fetchUrlDirect(
        url,
        context,
        operationId ?? observer.createOperationId("fetch")
      );
      return limitFetchResult(result, DEFAULT_MAX_CHARACTERS);
    },
    async fetchUrls(
      urls: string[],
      maxCharacters = DEFAULT_MAX_CHARACTERS,
      maxConcurrency = DEFAULT_MAX_CONCURRENCY,
      operationId?: string
    ) {
      const characterLimit = requireMaxCharacters(maxCharacters);
      const results = await fetchUrlsDirect(
        urls,
        characterLimit,
        maxConcurrency,
        context,
        operationId ?? observer.createOperationId("fetch")
      );
      return results.map((result) => limitFetchResult(result, characterLimit));
    },
  };
}

export function fetchUrl(url: string): Promise<FetchResult> {
  return defaultFetchOperations.fetchUrl(url);
}

async function fetchUrlDirect(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  context.validateUrl?.(url);
  assertProviderSafeUrl(url);
  // Phase 0: official keyless APIs for platforms generic fetch handles poorly
  // (matches only specific URLs; non-matching URLs cost nothing).
  const apiResult = await observeProviderAttempt(
    context.observer,
    { operation: "fetch", operationId, provider: "public-api" },
    () => fetchViaPublicApi(url)
  );
  if (apiResult) {
    return apiResult;
  }
  emitFallbackEvent(context.observer, {
    fromProvider: "public-api",
    operation: "fetch",
    operationId,
    reason: "empty",
    toProvider: getFirstFetchProviderName(context),
  });
  return fetchUrlViaProviders(url, context, operationId);
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
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult[]> {
  if (urls.length === 0) {
    return [];
  }

  const uniqueUrls = [...new Set(urls)];
  const uniqueResults = await fetchUniqueUrlsDirect(
    uniqueUrls,
    maxCharacters,
    maxConcurrency,
    context,
    operationId
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
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult[]> {
  for (const url of urls) {
    context.validateUrl?.(url);
    assertProviderSafeUrl(url);
  }

  // Phase 0 (parity with single fetch): route official-API URLs first, send the
  // rest through the provider batch, then reassemble in the original order.
  const apiResults = await mapWithConcurrency(urls, maxConcurrency, (url) =>
    observeProviderAttempt(
      context.observer,
      { operation: "fetch", operationId, provider: "public-api" },
      () => fetchViaPublicApi(url)
    )
  );
  const remaining = urls.filter((_url, index) => apiResults[index] === null);
  if (remaining.length > 0) {
    emitFallbackEvent(context.observer, {
      fromProvider: "public-api",
      operation: "fetch",
      operationId,
      reason: "empty",
      toProvider: getFirstFetchProviderName(context),
    });
  }
  if (remaining.length === urls.length) {
    return fetchUrlsViaProviders(
      urls,
      maxCharacters,
      context,
      maxConcurrency,
      operationId
    );
  }

  const remainingResults =
    remaining.length > 0
      ? await fetchUrlsViaProviders(
          remaining,
          maxCharacters,
          context,
          maxConcurrency,
          operationId
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

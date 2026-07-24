import type { resolveCacheOptions } from "./cache.ts";
import { assertValidMaxConcurrency } from "./fetch/concurrency.ts";
import type { FetchOperations } from "./fetch/orchestration.ts";
import type { FetchResult } from "./fetch/result.ts";
import type { FetchOptions, FetchService } from "./fetch.ts";
import { createFetchServiceCache } from "./fetch-service-cache.ts";
import { type OpenSearchObserver, observeOperation } from "./observability.ts";

export function createFetchServiceForOperations(
  operations: FetchOperations,
  defaultMaxConcurrency: number,
  cacheOptions: ReturnType<typeof resolveCacheOptions>,
  observer: OpenSearchObserver
): FetchService {
  const {
    emitFetchCacheBypass,
    fetchMultipleUrls,
    fetchMultipleUrlsWithCache,
    fetchSingleUrl,
    fetchSingleUrlWithCache,
  } = createFetchServiceCache(
    operations,
    defaultMaxConcurrency,
    cacheOptions,
    observer
  );

  function fetchInput(
    url: string,
    options?: FetchOptions
  ): Promise<FetchResult>;
  function fetchInput(
    urls: readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult[]>;
  function fetchInput(
    input: string | readonly string[],
    options?: FetchOptions
  ): Promise<FetchResult | FetchResult[]>;
  function fetchInput(
    input: string | readonly string[],
    options: FetchOptions = {}
  ): Promise<FetchResult | FetchResult[]> {
    const { maxCharacters } = options;
    const maxConcurrency = options.maxConcurrency ?? defaultMaxConcurrency;

    return observeOperation(
      observer,
      {
        inputCount: typeof input === "string" ? 1 : input.length,
        operation: "fetch",
      },
      async (operationId) => {
        assertValidMaxConcurrency(maxConcurrency);
        if (options.cache === "bypass") {
          return fetchWithoutCache(
            input,
            maxCharacters,
            maxConcurrency,
            operationId
          );
        }
        if (typeof input === "string") {
          if (maxCharacters === undefined) {
            return fetchSingleUrlWithCache(input, operationId);
          }

          const [result] = await fetchMultipleUrlsWithCache(
            [input],
            maxCharacters,
            maxConcurrency,
            operationId
          );
          if (!result) {
            throw new Error("Fetch returned no result.");
          }
          return result;
        }

        return fetchMultipleUrlsWithCache(
          [...input],
          maxCharacters,
          maxConcurrency,
          operationId
        );
      }
    );
  }

  async function fetchWithoutCache(
    input: string | readonly string[],
    maxCharacters: number | undefined,
    maxConcurrency: number,
    operationId?: string
  ): Promise<FetchResult | FetchResult[]> {
    emitFetchCacheBypass(operationId);
    const results = await fetchMultipleUrls(
      typeof input === "string" ? [input] : [...input],
      maxCharacters,
      maxConcurrency,
      operationId
    );
    if (typeof input === "string") {
      const [result] = results;
      if (!result) {
        throw new Error("Fetch returned no result.");
      }
      return result;
    }
    return results;
  }

  return {
    fetch: fetchInput,
    fetchUrl: fetchSingleUrl,
    fetchUrls: fetchMultipleUrls,
    fetchUrlsWithCache: fetchMultipleUrlsWithCache,
    fetchUrlWithCache: fetchSingleUrlWithCache,
  };
}

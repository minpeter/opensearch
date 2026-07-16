import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../environment.ts";
import type { TinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { NoFetchProviderError } from "./errors.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import {
  tryFetchUrlsViaFirecrawl,
  tryFetchUrlViaFirecrawl,
} from "./firecrawl-provider.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export type LocalFetch = (url: string) => Promise<FetchResult>;

export interface ExaMcpFetchBatchResult {
  readonly content: string;
  readonly title: string;
  readonly url: string;
}

export interface ExaMcpFetchProvider {
  fetchBatch(
    urls: string[],
    maxCharacters: number,
    env: EnvironmentReader
  ): Promise<readonly ExaMcpFetchBatchResult[]>;
  fetchUrl(url: string, env: EnvironmentReader): Promise<FetchResult | null>;
  isEnabled(env: EnvironmentReader): boolean;
}

export interface FetchPipelineContext {
  readonly env: EnvironmentReader;
  readonly exaApiKeyPool: ApiKeyPool;
  readonly exaMcpFetchProvider?: ExaMcpFetchProvider;
  readonly localFetch?: LocalFetch;
  readonly tinyFishApiKeyPool: TinyFishApiKeyPool;
}

export async function fetchUrlViaProviders(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  const exaMcpResult = await tryFetchUrlViaExaMcp(url, context);
  if (exaMcpResult) {
    return exaMcpResult;
  }

  if (context.tinyFishApiKeyPool.hasApiKeys()) {
    try {
      const [tinyFishResult] = await fetchTinyFishUrls(
        [url],
        context.tinyFishApiKeyPool
      );
      if (!tinyFishResult) {
        throw new Error("TinyFish fetch returned an unexpected response shape");
      }
      return createFetchResult(
        url,
        tinyFishResult.content,
        tinyFishResult.title
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return fetchUrlWithoutTinyFish(url, context);
    }
  }

  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await fetchExaApiForContext(url, context);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }

  const firecrawlResult = await tryFetchUrlViaFirecrawl(url, context.env);
  return firecrawlResult ?? runLocalFetch(url, context);
}

export async function fetchUrlsViaProviders(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number
): Promise<FetchResult[]> {
  if (context.exaMcpFetchProvider?.isEnabled(context.env)) {
    try {
      const exaResults = await context.exaMcpFetchProvider.fetchBatch(
        urls,
        maxCharacters,
        context.env
      );
      return urls.map((url, index) => {
        const exaResult =
          exaResults.find((result) => result.url === url) ?? exaResults[index];
        if (!exaResult) {
          throw new Error(
            "Exa MCP fetch returned an unexpected response shape"
          );
        }
        return createFetchResult(url, exaResult.content, exaResult.title);
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }

  if (context.tinyFishApiKeyPool.hasApiKeys()) {
    try {
      const tinyFishResults = await fetchTinyFishUrls(
        urls,
        context.tinyFishApiKeyPool
      );
      return urls.map((url, index) => {
        const result = tinyFishResults[index];
        if (!result) {
          throw new Error(
            "TinyFish fetch returned an unexpected response shape"
          );
        }
        return createFetchResult(url, result.content, result.title);
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return fetchUrlsWithoutTinyFish(
        urls,
        maxCharacters,
        context,
        maxConcurrency
      );
    }
  }

  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await fetchExaApiBatchWithPool(
        urls,
        maxCharacters,
        context.exaApiKeyPool
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }

  const firecrawlResults = await tryFetchUrlsViaFirecrawl(
    urls,
    maxCharacters,
    context.env,
    (url) => runLocalFetch(url, context),
    maxConcurrency
  );
  return (
    firecrawlResults ??
    mapWithConcurrency(urls, maxConcurrency, (url) =>
      fetchUrlViaProviders(url, context)
    )
  );
}

async function fetchUrlWithoutTinyFish(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await fetchExaApiForContext(url, context);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return runLocalFetch(url, context);
    }
  }

  const firecrawlResult = await tryFetchUrlViaFirecrawl(url, context.env);
  return firecrawlResult ?? runLocalFetch(url, context);
}

async function fetchUrlsWithoutTinyFish(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number
): Promise<FetchResult[]> {
  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await fetchExaApiBatchWithPool(
        urls,
        maxCharacters,
        context.exaApiKeyPool
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return mapWithConcurrency(urls, maxConcurrency, (url) =>
        runLocalFetch(url, context)
      );
    }
  }

  const firecrawlResults = await tryFetchUrlsViaFirecrawl(
    urls,
    maxCharacters,
    context.env,
    (url) => runLocalFetch(url, context),
    maxConcurrency
  );
  return (
    firecrawlResults ??
    mapWithConcurrency(urls, maxConcurrency, (url) =>
      runLocalFetch(url, context)
    )
  );
}

function runLocalFetch(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  if (!context.localFetch) {
    throw new NoFetchProviderError(url);
  }

  return context.localFetch(url);
}

function tryFetchUrlViaExaMcp(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult | null> {
  const provider = context.exaMcpFetchProvider;
  if (!provider?.isEnabled(context.env)) {
    return Promise.resolve(null);
  }
  return provider.fetchUrl(url, context.env);
}

async function fetchExaApiForContext(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  const [result] = await fetchExaApiBatchWithPool(
    [url],
    DEFAULT_MAX_CHARACTERS,
    context.exaApiKeyPool
  );

  if (!result) {
    throw new Error("Exa API fetch returned no text content");
  }
  return result;
}

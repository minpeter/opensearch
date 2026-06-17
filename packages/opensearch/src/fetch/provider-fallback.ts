import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../environment.ts";
import { processEnvironmentReader } from "../environment.ts";
import { fetchExaMcp, fetchExaMcpBatch } from "../providers/exa-mcp/client.ts";
import type { TinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  OPENSEARCH_ENABLE_EXA_MCP_ENV,
} from "./config.ts";
import { NoFetchProviderError } from "./errors.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import {
  tryFetchUrlsViaFirecrawl,
  tryFetchUrlViaFirecrawl,
} from "./firecrawl-provider.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export type LocalFetch = (url: string) => Promise<FetchResult>;

export interface FetchPipelineContext {
  readonly env: EnvironmentReader;
  readonly exaApiKeyPool: ApiKeyPool;
  readonly localFetch?: LocalFetch;
  readonly tinyFishApiKeyPool: TinyFishApiKeyPool;
}

export async function fetchUrlViaProviders(
  url: string,
  context: FetchPipelineContext
): Promise<FetchResult> {
  const exaMcpResult = await tryFetchUrlViaExaMcp(url, context.env);
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
  context: FetchPipelineContext
): Promise<FetchResult[]> {
  if (isExaMcpEnabled(context.env)) {
    try {
      const exaResults = await fetchExaMcpBatchForEnv(
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
      return fetchUrlsWithoutTinyFish(urls, maxCharacters, context);
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
    (url) => runLocalFetch(url, context)
  );
  return (
    firecrawlResults ??
    Promise.all(urls.map((url) => fetchUrlViaProviders(url, context)))
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
  context: FetchPipelineContext
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
      return Promise.all(urls.map((url) => runLocalFetch(url, context)));
    }
  }

  const firecrawlResults = await tryFetchUrlsViaFirecrawl(
    urls,
    maxCharacters,
    context.env,
    (url) => runLocalFetch(url, context)
  );
  return (
    firecrawlResults ??
    Promise.all(urls.map((url) => runLocalFetch(url, context)))
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

function fetchExaMcpForEnv(
  url: string,
  env: EnvironmentReader
): ReturnType<typeof fetchExaMcp> {
  return env === processEnvironmentReader
    ? fetchExaMcp(url)
    : fetchExaMcp(url, env);
}

function fetchExaMcpBatchForEnv(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader
): ReturnType<typeof fetchExaMcpBatch> {
  return env === processEnvironmentReader
    ? fetchExaMcpBatch(urls, maxCharacters)
    : fetchExaMcpBatch(urls, maxCharacters, env);
}

async function tryFetchUrlViaExaMcp(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult | null> {
  if (!isExaMcpEnabled(env)) {
    return null;
  }

  try {
    const result = await fetchExaMcpForEnv(url, env);
    return createFetchResult(url, result.content, result.title);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(OPENSEARCH_ENABLE_EXA_MCP_ENV) !== "false";
}

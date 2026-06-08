import {
  type ApiKeyPool,
  createApiKeyPool,
} from "../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { fetchExaMcp, fetchExaMcpBatch } from "../providers/exa-mcp/client.ts";
import {
  createTinyFishApiKeyPool,
  type TinyFishApiKeyPool,
} from "../providers/tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  EXA_API_KEY_ENV,
  OPENSEARCH_ENABLE_EXA_MCP_ENV,
} from "./config.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import { fetchLocalUrl } from "./local.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export interface FetchOperations {
  fetchUrl(url: string): Promise<FetchResult>;
  fetchUrls(urls: string[], maxCharacters?: number): Promise<FetchResult[]>;
}

interface FetchPipelineContext {
  readonly env: EnvironmentReader;
  readonly exaApiKeyPool: ApiKeyPool;
  readonly tinyFishApiKeyPool: TinyFishApiKeyPool;
}

const defaultFetchOperations = createFetchOperations(processEnvironmentReader);

export function createFetchOperations(
  env: EnvironmentReader = processEnvironmentReader
): FetchOperations {
  const context: FetchPipelineContext = {
    exaApiKeyPool: createApiKeyPool(EXA_API_KEY_ENV, env),
    env,
    tinyFishApiKeyPool: createTinyFishApiKeyPool(env),
  };

  return {
    fetchUrl(url: string) {
      return fetchUrlDirect(url, context);
    },
    fetchUrls(urls: string[], maxCharacters = DEFAULT_MAX_CHARACTERS) {
      return fetchUrlsDirect(urls, maxCharacters, context);
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
  if (isExaMcpEnabled(context.env)) {
    try {
      const exaResult = await fetchExaMcpForEnv(url, context.env);
      return createFetchResult(url, exaResult.content, exaResult.title);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      // Fall through to the official Exa API or local fetch pipeline.
    }
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
      // Fall through to the local fetch pipeline.
    }
  }

  return fetchLocalUrl(url);
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
      return fetchLocalUrl(url);
    }
  }

  return fetchLocalUrl(url);
}

export function fetchUrls(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS
): Promise<FetchResult[]> {
  return defaultFetchOperations.fetchUrls(urls, maxCharacters);
}

async function fetchUrlsDirect(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext
): Promise<FetchResult[]> {
  if (urls.length === 0) {
    return [];
  }

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
      // Fall through to the official Exa API or local fetch pipeline.
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
      // Fall through to the local fetch pipeline.
    }
  }

  return Promise.all(urls.map((url) => fetchUrlDirect(url, context)));
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
      return Promise.all(urls.map((url) => fetchLocalUrl(url)));
    }
  }

  return Promise.all(urls.map((url) => fetchLocalUrl(url)));
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

function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(OPENSEARCH_ENABLE_EXA_MCP_ENV) !== "false";
}

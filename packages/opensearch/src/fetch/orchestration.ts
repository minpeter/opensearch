import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { fetchExaMcp, fetchExaMcpBatch } from "../exa-mcp.ts";
import {
  createTinyFishApiKeyPool,
  type TinyFishApiKeyPool,
} from "../tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../tinyfish/fetch.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  EXA_API_KEY_ENV,
  OPENSEARCH_ENABLE_EXA_MCP_ENV,
} from "./config.ts";
import { fetchExaApi, fetchExaApiBatch } from "./exa-api.ts";
import { fetchLocalUrl } from "./local.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export interface FetchOperations {
  fetchUrl(url: string): Promise<FetchResult>;
  fetchUrls(urls: string[], maxCharacters?: number): Promise<FetchResult[]>;
}

interface FetchPipelineContext {
  readonly env: EnvironmentReader;
  readonly tinyFishApiKeyPool: TinyFishApiKeyPool;
}

const defaultFetchOperations = createFetchOperations(processEnvironmentReader);

export function createFetchOperations(
  env: EnvironmentReader = processEnvironmentReader
): FetchOperations {
  const context: FetchPipelineContext = {
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

  if (hasExaApiKey(context.env)) {
    try {
      return await fetchExaApiForEnv(url, context.env);
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
  if (hasExaApiKey(context.env)) {
    try {
      return await fetchExaApiForEnv(url, context.env);
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

  if (hasExaApiKey(context.env)) {
    try {
      return await fetchExaApiBatchForEnv(urls, maxCharacters, context.env);
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
  if (hasExaApiKey(context.env)) {
    try {
      return await fetchExaApiBatchForEnv(urls, maxCharacters, context.env);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return Promise.all(urls.map((url) => fetchLocalUrl(url)));
    }
  }

  return Promise.all(urls.map((url) => fetchLocalUrl(url)));
}

function hasExaApiKey(env: EnvironmentReader): boolean {
  return Boolean(env.read(EXA_API_KEY_ENV)?.trim());
}

function fetchExaApiForEnv(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult> {
  return env === processEnvironmentReader
    ? fetchExaApi(url)
    : fetchExaApi(url, env);
}

function fetchExaApiBatchForEnv(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader
): Promise<FetchResult[]> {
  return env === processEnvironmentReader
    ? fetchExaApiBatch(urls, maxCharacters)
    : fetchExaApiBatch(urls, maxCharacters, env);
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

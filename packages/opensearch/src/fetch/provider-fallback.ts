import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../environment.ts";
import {
  emitFallbackEvent,
  getFailureKind,
  type OpenSearchObserver,
  observeProviderAttempt,
} from "../observability.ts";
import { isFirecrawlEnabled } from "../providers/firecrawl/client.ts";
import {
  isOllamaEnabled,
  isOllamaLocalEnabled,
  readOllamaApiKey,
} from "../providers/ollama/client.ts";
import { getHttpStatus } from "../providers/shared/error.ts";
import type { TinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { NoFetchProviderError } from "./errors.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import {
  fetchUrlsViaFirecrawl,
  fetchUrlViaFirecrawl,
} from "./firecrawl-provider.ts";
import { tryFetchUrlViaOllama } from "./ollama-provider.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export type LocalFetch = (url: string) => Promise<FetchResult>;
export type FetchUrlValidator = (url: string) => void;

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
  readonly observer: OpenSearchObserver;
  readonly tinyFishApiKeyPool: TinyFishApiKeyPool;
  readonly validateUrl?: FetchUrlValidator;
}

export function fetchUrlViaProviders(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  return fetchUrlViaProvidersInternal(url, context, operationId, true);
}

async function fetchUrlViaProvidersInternal(
  url: string,
  context: FetchPipelineContext,
  operationId: string,
  tryOllama: boolean
): Promise<FetchResult> {
  const ollamaResult = await tryFetchUrlWithOllama(
    url,
    context,
    operationId,
    tryOllama
  );
  if (ollamaResult) {
    return ollamaResult;
  }

  const exaMcpEnabled =
    context.exaMcpFetchProvider?.isEnabled(context.env) ?? false;
  const exaMcpResult = await tryFetchUrlViaExaMcp(url, context, operationId);
  if (exaMcpResult) {
    return exaMcpResult;
  }
  if (exaMcpEnabled) {
    emitFetchFallback(
      context,
      operationId,
      "exa-mcp",
      firstConfiguredFetchProvider(context),
      "empty"
    );
  }

  if (!context.tinyFishApiKeyPool.hasApiKeys()) {
    return fetchUrlWithoutTinyFish(url, context, operationId);
  }

  return fetchUrlViaTinyFish(url, context, operationId);
}

export function fetchUrlsViaProviders(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number,
  operationId: string
): Promise<FetchResult[]> {
  if (canTryOllama(context)) {
    return fetchUrlsViaOllama(
      urls,
      maxCharacters,
      context,
      maxConcurrency,
      operationId
    );
  }

  return fetchUrlsAfterOllama(
    urls,
    maxCharacters,
    context,
    maxConcurrency,
    operationId
  );
}

async function fetchUrlsAfterOllama(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number,
  operationId: string
): Promise<FetchResult[]> {
  const exaMcpResults = await tryFetchUrlsViaExaMcp(
    urls,
    maxCharacters,
    context,
    operationId
  );
  if (exaMcpResults) {
    return exaMcpResults;
  }

  if (!context.tinyFishApiKeyPool.hasApiKeys()) {
    return fetchUrlsWithoutTinyFish(
      urls,
      maxCharacters,
      context,
      maxConcurrency,
      operationId
    );
  }

  return fetchUrlsViaTinyFish(
    urls,
    maxCharacters,
    context,
    maxConcurrency,
    operationId
  );
}

async function tryFetchUrlWithOllama(
  url: string,
  context: FetchPipelineContext,
  operationId: string,
  enabled: boolean,
  maxCharacters = DEFAULT_MAX_CHARACTERS
): Promise<FetchResult | null> {
  if (!(enabled && canTryOllama(context))) {
    return null;
  }

  try {
    const result = await observeFetchProvider(
      context,
      operationId,
      "ollama",
      () =>
        tryFetchUrlViaOllama(url, maxCharacters, context.env, {
          localEnabled: context.localFetch !== undefined,
        })
    );
    if (!result) {
      emitFetchFallback(
        context,
        operationId,
        "ollama",
        firstProviderAfterOllama(context),
        "empty"
      );
    }
    return result;
  } catch (error) {
    assertFallbackAllowed(error);
    emitFetchFallback(
      context,
      operationId,
      "ollama",
      firstProviderAfterOllama(context),
      getFailureKind(error)
    );
    return null;
  }
}

async function fetchUrlViaTinyFish(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  try {
    const [result] = await observeFetchProvider(
      context,
      operationId,
      "tinyfish",
      () => fetchTinyFishUrls([url], context.tinyFishApiKeyPool)
    );
    if (!result) {
      throw new Error("TinyFish fetch returned an unexpected response shape");
    }
    return createFetchResult(url, result.content, result.title);
  } catch (error) {
    assertFallbackAllowed(error);
    emitFetchFallback(
      context,
      operationId,
      "tinyfish",
      nextProviderWithoutTinyFish(context),
      getFailureKind(error)
    );
    return fetchUrlWithoutTinyFish(url, context, operationId);
  }
}

async function fetchUrlsViaOllama(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number,
  operationId: string
): Promise<FetchResult[]> {
  const ollamaResults = await mapWithConcurrency(urls, maxConcurrency, (url) =>
    tryFetchUrlWithOllama(url, context, operationId, true, maxCharacters)
  );
  const remainingUrls = urls.filter(
    (_url, index) => ollamaResults[index] === null
  );
  if (remainingUrls.length === 0) {
    return ollamaResults.filter(
      (result): result is FetchResult => result !== null
    );
  }

  const remainingResults = await fetchUrlsAfterOllama(
    remainingUrls,
    maxCharacters,
    context,
    maxConcurrency,
    operationId
  );
  let remainingIndex = 0;
  return ollamaResults.map((result) => {
    if (result) {
      return result;
    }
    const fallbackResult = remainingResults[remainingIndex];
    remainingIndex += 1;
    if (!fallbackResult) {
      throw new Error("Ollama fallback returned an unexpected response shape");
    }
    return fallbackResult;
  });
}

async function tryFetchUrlsViaExaMcp(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult[] | null> {
  const provider = context.exaMcpFetchProvider;
  if (!provider?.isEnabled(context.env)) {
    return null;
  }

  try {
    return await observeFetchProvider(
      context,
      operationId,
      "exa-mcp",
      async () => {
        const results = await provider.fetchBatch(
          urls,
          maxCharacters,
          context.env
        );
        return urls.map((url, index) => {
          const result =
            results.find((candidate) => candidate.url === url) ??
            results[index];
          if (!result) {
            throw new Error(
              "Exa MCP fetch returned an unexpected response shape"
            );
          }
          return createFetchResult(url, result.content, result.title);
        });
      }
    );
  } catch (error) {
    assertFallbackAllowed(error);
    emitFetchFallback(
      context,
      operationId,
      "exa-mcp",
      firstConfiguredFetchProvider(context),
      getFailureKind(error)
    );
    return null;
  }
}

async function fetchUrlsViaTinyFish(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number,
  operationId: string
): Promise<FetchResult[]> {
  try {
    return await observeFetchProvider(
      context,
      operationId,
      "tinyfish",
      async () => {
        const results = await fetchTinyFishUrls(
          urls,
          context.tinyFishApiKeyPool
        );
        return urls.map((url, index) => {
          const result = results[index];
          if (!result) {
            throw new Error(
              "TinyFish fetch returned an unexpected response shape"
            );
          }
          return createFetchResult(url, result.content, result.title);
        });
      }
    );
  } catch (error) {
    assertFallbackAllowed(error);
    emitFetchFallback(
      context,
      operationId,
      "tinyfish",
      nextProviderWithoutTinyFish(context),
      getFailureKind(error)
    );
    return fetchUrlsWithoutTinyFish(
      urls,
      maxCharacters,
      context,
      maxConcurrency,
      operationId
    );
  }
}

async function fetchUrlWithoutTinyFish(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await fetchExaApiForContext(url, context, operationId);
    } catch (error) {
      assertFallbackAllowed(error);
      emitFetchFallback(
        context,
        operationId,
        "exa-api",
        nextProviderAfterExa(context),
        getFailureKind(error)
      );
      if (!isFirecrawlEnabled(context.env)) {
        return runLocalFetch(url, context, operationId);
      }
    }
  }

  if (isFirecrawlEnabled(context.env)) {
    try {
      return await observeFetchProvider(context, operationId, "firecrawl", () =>
        fetchUrlViaFirecrawl(url, context.env)
      );
    } catch (error) {
      assertFallbackAllowed(error);
      emitFetchFallback(
        context,
        operationId,
        "firecrawl",
        "local",
        getFailureKind(error)
      );
    }
  }
  return runLocalFetch(url, context, operationId);
}

async function fetchUrlsWithoutTinyFish(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  maxConcurrency: number,
  operationId: string
): Promise<FetchResult[]> {
  if (context.exaApiKeyPool.hasApiKeys()) {
    try {
      return await observeFetchProvider(context, operationId, "exa-api", () =>
        fetchExaApiBatchWithPool(urls, maxCharacters, context.exaApiKeyPool)
      );
    } catch (error) {
      assertFallbackAllowed(error);
      emitFetchFallback(
        context,
        operationId,
        "exa-api",
        nextProviderAfterExa(context),
        getFailureKind(error)
      );
      if (!isFirecrawlEnabled(context.env)) {
        return mapWithConcurrency(urls, maxConcurrency, (url) =>
          runLocalFetch(url, context, operationId)
        );
      }
    }
  }

  if (isFirecrawlEnabled(context.env)) {
    return observeFetchProvider(context, operationId, "firecrawl", () =>
      fetchUrlsViaFirecrawl(
        urls,
        maxCharacters,
        context.env,
        (url) => runLocalFetch(url, context, operationId),
        maxConcurrency,
        (_url, error) => {
          emitFetchFallback(
            context,
            operationId,
            "firecrawl",
            "local",
            getFailureKind(error)
          );
        }
      )
    );
  }
  return mapWithConcurrency(urls, maxConcurrency, (url) =>
    runLocalFetch(url, context, operationId)
  );
}

function runLocalFetch(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  return observeFetchProvider(context, operationId, "local", () => {
    if (!context.localFetch) {
      throw new NoFetchProviderError(url);
    }
    return context.localFetch(url);
  });
}

function tryFetchUrlViaExaMcp(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult | null> {
  const provider = context.exaMcpFetchProvider;
  if (!provider?.isEnabled(context.env)) {
    return Promise.resolve(null);
  }
  return observeFetchProvider(context, operationId, "exa-mcp", () =>
    provider.fetchUrl(url, context.env)
  );
}

async function fetchExaApiForContext(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult> {
  const [result] = await observeFetchProvider(
    context,
    operationId,
    "exa-api",
    () =>
      fetchExaApiBatchWithPool(
        [url],
        DEFAULT_MAX_CHARACTERS,
        context.exaApiKeyPool
      )
  );

  if (!result) {
    throw new Error("Exa API fetch returned no text content");
  }
  return result;
}

function observeFetchProvider<T>(
  context: FetchPipelineContext,
  operationId: string,
  provider: string,
  execute: () => Promise<T>
): Promise<T> {
  return observeProviderAttempt(
    context.observer,
    { operation: "fetch", operationId, provider },
    execute
  );
}

function emitFetchFallback(
  context: FetchPipelineContext,
  operationId: string,
  fromProvider: string,
  toProvider: string,
  reason: "empty" | ReturnType<typeof getFailureKind>
): void {
  emitFallbackEvent(context.observer, {
    fromProvider,
    operation: "fetch",
    operationId,
    reason,
    toProvider,
  });
}

function firstConfiguredFetchProvider(context: FetchPipelineContext): string {
  if (context.tinyFishApiKeyPool.hasApiKeys()) {
    return "tinyfish";
  }
  return nextProviderWithoutTinyFish(context);
}

function nextProviderWithoutTinyFish(context: FetchPipelineContext): string {
  return context.exaApiKeyPool.hasApiKeys()
    ? "exa-api"
    : nextProviderAfterExa(context);
}

function nextProviderAfterExa(context: FetchPipelineContext): string {
  return isFirecrawlEnabled(context.env) ? "firecrawl" : "local";
}

export function getFirstFetchProviderName(
  context: FetchPipelineContext
): string {
  if (canTryOllama(context)) {
    return "ollama";
  }
  return firstProviderAfterOllama(context);
}

function canTryOllama(context: FetchPipelineContext): boolean {
  if (!isOllamaEnabled(context.env)) {
    return false;
  }

  const localAvailable =
    context.localFetch !== undefined && isOllamaLocalEnabled(context.env);
  return localAvailable || readOllamaApiKey(context.env) !== null;
}

function firstProviderAfterOllama(context: FetchPipelineContext): string {
  if (context.exaMcpFetchProvider?.isEnabled(context.env)) {
    return "exa-mcp";
  }
  return firstConfiguredFetchProvider(context);
}

function assertFallbackAllowed(error: unknown): asserts error is Error {
  if (!(error instanceof Error) || getHttpStatus(error) === 451) {
    throw error;
  }
}

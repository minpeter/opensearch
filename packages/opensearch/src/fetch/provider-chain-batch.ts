import { getFailureKind } from "../observability.ts";
import { isFirecrawlEnabled } from "../providers/firecrawl/client.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import { fetchUrlsViaFirecrawl } from "./firecrawl-provider.ts";
import { tryFetchUrlsViaExaMcp } from "./provider-chain-exa-mcp.ts";
import {
  runLocalFetch,
  tryFetchUrlWithOllama,
} from "./provider-chain-single.ts";
import {
  assertFallbackAllowed,
  canTryOllama,
  emitFetchFallback,
  type FetchPipelineContext,
  nextProviderAfterExa,
  nextProviderWithoutTinyFish,
  observeFetchProvider,
} from "./provider-context.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

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

import { getFailureKind } from "../observability.ts";
import { isFirecrawlEnabled } from "../providers/firecrawl/client.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { NoFetchProviderError } from "./errors.ts";
import { fetchExaApiBatchWithPool } from "./exa-api.ts";
import { fetchUrlViaFirecrawl } from "./firecrawl-provider.ts";
import { tryFetchUrlViaOllama } from "./ollama-provider.ts";
import { tryFetchUrlViaExaMcp } from "./provider-chain-exa-mcp.ts";
import {
  assertFallbackAllowed,
  canTryOllama,
  emitFetchFallback,
  type FetchPipelineContext,
  firstConfiguredFetchProvider,
  firstProviderAfterOllama,
  nextProviderAfterExa,
  nextProviderWithoutTinyFish,
  observeFetchProvider,
} from "./provider-context.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

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
    // biome-ignore lint/suspicious/noUnnecessaryConditions: defensive fallback handles an optional provider supplied at runtime
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

export async function tryFetchUrlWithOllama(
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

export function runLocalFetch(
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

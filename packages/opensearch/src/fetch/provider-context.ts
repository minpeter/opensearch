import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../environment.ts";
import {
  emitFallbackEvent,
  type getFailureKind,
  type OpenSearchObserver,
  observeProviderAttempt,
} from "../observability.ts";
import { isFirecrawlEnabled } from "../providers/firecrawl/client.ts";
import {
  isOllamaEnabled,
  isOllamaLocalEnabled,
  readOllamaApiKey,
} from "../providers/ollama/config.ts";
import { getHttpStatus } from "../providers/shared/error.ts";
import type { TinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import type { FetchResult } from "./result.ts";

export type LocalFetch = (url: string) => Promise<FetchResult>;
export type FetchUrlValidator = (url: string) => void;

export interface ExaMcpFetchBatchResult {
  readonly content: string;
  readonly title: string;
  readonly url: string;
}

export interface ExaMcpFetchProvider {
  fetchBatch: (
    urls: string[],
    maxCharacters: number,
    env: EnvironmentReader
  ) => Promise<readonly ExaMcpFetchBatchResult[]>;
  fetchUrl: (
    url: string,
    env: EnvironmentReader
  ) => Promise<FetchResult | null>;
  isEnabled: (env: EnvironmentReader) => boolean;
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

export function observeFetchProvider<T>(
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

export function emitFetchFallback(
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

export function firstConfiguredFetchProvider(
  context: FetchPipelineContext
): string {
  if (context.tinyFishApiKeyPool.hasApiKeys()) {
    return "tinyfish";
  }
  return nextProviderWithoutTinyFish(context);
}

export function nextProviderWithoutTinyFish(
  context: FetchPipelineContext
): string {
  return context.exaApiKeyPool.hasApiKeys()
    ? "exa-api"
    : nextProviderAfterExa(context);
}

export function nextProviderAfterExa(context: FetchPipelineContext): string {
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

export function canTryOllama(context: FetchPipelineContext): boolean {
  if (!isOllamaEnabled(context.env)) {
    return false;
  }

  const localAvailable =
    context.localFetch !== undefined && isOllamaLocalEnabled(context.env);
  return localAvailable || readOllamaApiKey(context.env) !== null;
}

export function firstProviderAfterOllama(
  context: FetchPipelineContext
): string {
  if (context.exaMcpFetchProvider?.isEnabled(context.env)) {
    return "exa-mcp";
  }
  return firstConfiguredFetchProvider(context);
}

export function assertFallbackAllowed(error: unknown): asserts error is Error {
  if (!(error instanceof Error) || getHttpStatus(error) === 451) {
    throw error;
  }
}

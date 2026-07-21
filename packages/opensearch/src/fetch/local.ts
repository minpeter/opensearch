import {
  assertSafeHttpUrl,
  createNetworkDispatcher,
  NetworkPolicyError,
} from "../node/network-policy.ts";
import { fetchViaPlaywrightFallback } from "../node/playwright-executor.ts";
import { fetchViaTlsImpersonation } from "../node/tls-executor.ts";
import { ResponseSizeLimitError } from "../response-body.ts";
import { fetchViaArchiveFallback } from "./archive-result.ts";
import { runAttemptPlan } from "./attempt-planner.ts";
import { isChallengePage } from "./challenge.ts";
import { fetchJinaReader } from "./jina.ts";
import { resultFromResponse } from "./local-extract.ts";
import {
  type LocalFetchOptions,
  resolveLocalFetchOptions,
} from "./local-options.ts";
import {
  fetchAttemptResponse,
  fetchPage,
  type LocalFetchContext,
} from "./local-request.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

const SPARSE_CONTENT_THRESHOLD = 50;
const BLOCK_STATUSES = new Set([403, 429, 503]);

function abortLocalFetchFallback(error: unknown): boolean {
  return (
    error instanceof NetworkPolicyError ||
    error instanceof ResponseSizeLimitError
  );
}

async function fetchLocalUrlWithContext(
  url: string,
  context: LocalFetchContext
): Promise<FetchResult> {
  assertSafeHttpUrl(url, context.options.allowPrivateNetwork);
  const planned = await runAttemptPlan(url, {
    abortOnError: abortLocalFetchFallback,
    executor: (input) => fetchAttemptResponse(input, context),
  });

  if (planned.response) {
    const result = await resultFromResponse(url, planned.response, context);
    if (result) {
      return result;
    }
  }

  const firstStatus = planned.trace[0]?.status;
  if (
    typeof firstStatus === "number" &&
    firstStatus >= 400 &&
    !BLOCK_STATUSES.has(firstStatus)
  ) {
    throw new Error(`Fetch failed with status ${firstStatus}`);
  }

  const reader =
    // biome-ignore lint/suspicious/noUnnecessaryConditions: defensive fallback preserves the optional provider contract at runtime
    (
      await fetchJinaReader(url, {
        maxResponseBytes: context.options.maxDownloadBytes,
      })
    )?.content ?? null;
  if (
    reader &&
    reader.length >= SPARSE_CONTENT_THRESHOLD &&
    !isChallengePage(reader)
  ) {
    return createFetchResult(url, reader);
  }
  const fallbackOptions = {
    abortOnError: abortLocalFetchFallback,
    maxRedirects: context.options.maxRedirects,
    maxResponseBytes: context.options.maxDownloadBytes,
    validateUrl: (candidateUrl: string) => {
      assertSafeHttpUrl(candidateUrl, context.options.allowPrivateNetwork);
    },
  };
  const tlsResult = await fetchViaTlsImpersonation(url, fallbackOptions);
  if (tlsResult.response) {
    const result = await resultFromResponse(url, tlsResult.response, context);
    if (result) {
      return result;
    }
  }
  const playwrightResult = await fetchViaPlaywrightFallback(
    url,
    fallbackOptions
  );
  if (playwrightResult.response) {
    const result = await resultFromResponse(
      url,
      playwrightResult.response,
      context
    );
    if (result) {
      return result;
    }
  }
  const archiveResult = await fetchViaArchiveFallback(
    url,
    (archiveUrl, response) => resultFromResponse(archiveUrl, response, context),
    (archiveUrl) => fetchPage(archiveUrl, context)
  );
  if (archiveResult) {
    return archiveResult;
  }
  throw new Error("Fetch blocked by an anti-bot challenge");
}

export function createLocalFetch(
  options: LocalFetchOptions = {}
): (url: string) => Promise<FetchResult> {
  const resolvedOptions = resolveLocalFetchOptions(options);
  const context: LocalFetchContext = {
    dispatcher: createNetworkDispatcher({
      allowPrivateNetwork: resolvedOptions.allowPrivateNetwork,
      maxResponseBytes: resolvedOptions.maxDownloadBytes,
    }),
    options: resolvedOptions,
  };
  return (url) => fetchLocalUrlWithContext(url, context);
}

const defaultLocalFetch = createLocalFetch();

export function fetchLocalUrl(url: string): Promise<FetchResult> {
  return defaultLocalFetch(url);
}

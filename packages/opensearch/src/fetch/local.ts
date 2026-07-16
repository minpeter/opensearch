import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { Dispatcher } from "undici";
import { extractText, getDocumentProxy } from "unpdf";
import {
  assertSafeHttpUrl,
  createNetworkDispatcher,
  NetworkPolicyError,
} from "../node/network-policy.ts";
import { fetchViaPlaywrightFallback } from "../node/playwright-executor.ts";
import { fetchViaTlsImpersonation } from "../node/tls-executor.ts";
import { ResponseSizeLimitError, readResponseBytes } from "../response-body.ts";
import { BROWSER_HEADERS } from "../search/http.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { fetchViaArchiveFallback } from "./archive-result.ts";
import {
  type AttemptExecutorInput,
  runAttemptPlan,
} from "./attempt-planner.ts";
import { isChallengePage } from "./challenge.ts";
import { fetchDiscoveredFeed, isFeedResponse, parseFeed } from "./feed.ts";
import { fetchJinaReader } from "./jina.ts";
import {
  type LocalFetchOptions,
  type ResolvedLocalFetchOptions,
  resolveLocalFetchOptions,
} from "./local-options.ts";
import { extractMetadata, metadataToMarkdown } from "./metadata.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const SPARSE_CONTENT_THRESHOLD = 50;
const BLOCK_STATUSES = new Set([403, 429, 503]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface LocalFetchContext {
  readonly dispatcher: Dispatcher;
  readonly options: ResolvedLocalFetchOptions;
}

function abortLocalFetchFallback(error: unknown): boolean {
  return (
    error instanceof NetworkPolicyError ||
    error instanceof ResponseSizeLimitError
  );
}

type DispatcherRequestInit = RequestInit & {
  readonly dispatcher: Dispatcher;
};

function buildRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    "User-Agent": getRandomUserAgent(),
  };
  try {
    // A same-origin Referer makes the request look like in-site navigation,
    // which referer-gating WAFs expect.
    headers.Referer = `${new URL(url).origin}/`;
  } catch {
    // Non-absolute URL — let the fetch surface the error itself.
  }
  return headers;
}

async function fetchPage(
  rawUrl: string,
  context: LocalFetchContext
): Promise<Response> {
  let url = assertSafeHttpUrl(rawUrl, context.options.allowPrivateNetwork);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetch(url, {
      dispatcher: context.dispatcher,
      headers: buildRequestHeaders(url.toString()),
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    } as DispatcherRequestInit);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }
    if (redirectCount >= context.options.maxRedirects) {
      await response.body?.cancel();
      throw new NetworkPolicyError(
        `Fetch exceeded the ${context.options.maxRedirects}-redirect limit`
      );
    }

    await response.body?.cancel();
    url = assertSafeHttpUrl(
      new URL(location, url),
      context.options.allowPrivateNetwork
    );
  }
}

async function fetchAttemptResponse(
  input: AttemptExecutorInput,
  context: LocalFetchContext
) {
  const response = await fetchPage(input.url, context);
  const bytes = await readResponseBytes(
    response,
    context.options.maxDownloadBytes
  );
  const body = new TextDecoder().decode(bytes);
  return {
    body,
    headers: response.headers,
    response: new Response(Uint8Array.from(bytes).buffer, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    }),
    status: response.status,
    url: response.url || input.url,
  };
}

async function extractPdfContent(buffer: Uint8Array): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function isPdf(url: string, contentType: string): boolean {
  return url.endsWith(".pdf") || contentType.includes("application/pdf");
}

async function resultFromResponse(
  url: string,
  response: Response,
  context: LocalFetchContext
): Promise<FetchResult | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const bytes = await readResponseBytes(
    response,
    context.options.maxDownloadBytes
  );
  if (isFeedResponse(contentType)) {
    const feed = parseFeed(url, new TextDecoder().decode(bytes), "feed:direct");
    if (feed) {
      return feed;
    }
  }
  if (isPdf(url, contentType)) {
    return createFetchResult(url, await extractPdfContent(bytes));
  }
  const raw = new TextDecoder().decode(bytes);
  if (isChallengePage(raw)) {
    return null;
  }
  return buildResultFromHtml(url, raw, context);
}

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    linkStyle: "referenced",
  });
  turndown.use(gfm);
  turndown.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });
  return turndown;
}

/** markdown → reader → structured metadata, in descending fullness. */
async function resolveContent(
  url: string,
  markdown: string,
  metadataMarkdown: string,
  context: LocalFetchContext,
  feedContent: () => Promise<string | null> = () => Promise.resolve(null)
): Promise<string> {
  if (markdown.length >= SPARSE_CONTENT_THRESHOLD) {
    return markdown;
  }
  const reader =
    (
      await fetchJinaReader(url, {
        maxResponseBytes: context.options.maxDownloadBytes,
      })
    )?.content ?? null;
  if (reader && reader.length >= SPARSE_CONTENT_THRESHOLD) {
    return reader;
  }
  const feed = await feedContent();
  if (feed && feed.length >= SPARSE_CONTENT_THRESHOLD) {
    return feed;
  }
  if (metadataMarkdown.length >= SPARSE_CONTENT_THRESHOLD) {
    return metadataMarkdown;
  }
  return markdown || reader || feed || metadataMarkdown;
}

async function buildResultFromHtml(
  url: string,
  html: string,
  context: LocalFetchContext
): Promise<FetchResult> {
  const doc = new JSDOM(html.replace(IMG_TAG_REGEX, ""), { url });
  const article = new Readability(doc.window.document).parse();
  const markdown = createTurndown().turndown(article?.content ?? "");
  const metadata = extractMetadata(doc);
  const title = (article?.title ?? "").trim() || metadata.title;
  const content = await resolveContent(
    url,
    markdown,
    metadataToMarkdown(metadata),
    context,
    async () => {
      const feed = await fetchDiscoveredFeed(url, {
        fetcher: (candidateUrl) => fetchPage(candidateUrl, context),
        html,
        includeTransforms: false,
        maxResponseBytes: context.options.maxDownloadBytes,
      });
      return feed?.content ?? null;
    }
  );
  return createFetchResult(url, content, title);
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

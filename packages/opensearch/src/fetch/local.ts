import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchViaPlaywrightFallback } from "../node/playwright-executor.ts";
import { fetchViaTlsImpersonation } from "../node/tls-executor.ts";
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
import { extractMetadata, metadataToMarkdown } from "./metadata.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const SPARSE_CONTENT_THRESHOLD = 50;
const BLOCK_STATUSES = new Set([403, 429, 503]);

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

function fetchPage(url: string): Promise<Response> {
  return fetch(url, {
    headers: buildRequestHeaders(url),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function fetchAttemptResponse(input: AttemptExecutorInput) {
  const response = await fetchPage(input.url);
  return {
    body: await response.clone().text(),
    headers: response.headers,
    response,
    status: response.status,
    url: response.url || input.url,
  };
}

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function isPdf(url: string, contentType: string): boolean {
  return url.endsWith(".pdf") || contentType.includes("application/pdf");
}

async function resultFromResponse(
  url: string,
  response: Response
): Promise<FetchResult | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (isFeedResponse(contentType)) {
    const feed = parseFeed(url, await response.text(), "feed:direct");
    if (feed) {
      return feed;
    }
  }
  if (isPdf(url, contentType)) {
    return createFetchResult(
      url,
      await extractPdfContent(await response.arrayBuffer())
    );
  }
  const raw = await response.text();
  if (isChallengePage(raw)) {
    return null;
  }
  return buildResultFromHtml(url, raw);
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
  feedContent: () => Promise<string | null> = () => Promise.resolve(null)
): Promise<string> {
  if (markdown.length >= SPARSE_CONTENT_THRESHOLD) {
    return markdown;
  }
  const reader = (await fetchJinaReader(url))?.content ?? null;
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
  html: string
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
    async () => {
      const feed = await fetchDiscoveredFeed(url, {
        html,
        includeTransforms: false,
      });
      return feed?.content ?? null;
    }
  );
  return createFetchResult(url, content, title);
}

export async function fetchLocalUrl(url: string): Promise<FetchResult> {
  const planned = await runAttemptPlan(url, {
    executor: fetchAttemptResponse,
  });

  if (planned.response) {
    const result = await resultFromResponse(url, planned.response);
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

  const reader = (await fetchJinaReader(url))?.content ?? null;
  if (
    reader &&
    reader.length >= SPARSE_CONTENT_THRESHOLD &&
    !isChallengePage(reader)
  ) {
    return createFetchResult(url, reader);
  }
  const tlsResult = await fetchViaTlsImpersonation(url);
  if (tlsResult.response) {
    const result = await resultFromResponse(url, tlsResult.response);
    if (result) {
      return result;
    }
  }
  const playwrightResult = await fetchViaPlaywrightFallback(url);
  if (playwrightResult.response) {
    const result = await resultFromResponse(url, playwrightResult.response);
    if (result) {
      return result;
    }
  }
  const archiveResult = await fetchViaArchiveFallback(url, resultFromResponse);
  if (archiveResult) {
    return archiveResult;
  }
  throw new Error("Fetch blocked by an anti-bot challenge");
}

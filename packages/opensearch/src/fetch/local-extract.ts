import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";
import { readResponseBytes } from "../response-body.ts";
import { isChallengePage } from "./challenge.ts";
import { fetchDiscoveredFeed, isFeedResponse, parseFeed } from "./feed.ts";
import { fetchJinaReader } from "./jina.ts";
import type { LocalFetchContext } from "./local-request.ts";
import { fetchPage } from "./local-request.ts";
import { extractMetadata, metadataToMarkdown } from "./metadata.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const IMG_TAG_REGEX = /<img[^>]*>/g;
const SPARSE_CONTENT_THRESHOLD = 50;

async function extractPdfContent(buffer: Uint8Array): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function isPdf(url: string, contentType: string): boolean {
  return url.endsWith(".pdf") || contentType.includes("application/pdf");
}

export async function resultFromResponse(
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
    const feed = parseFeed(url, new TextDecoder().decode(bytes));
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
    // biome-ignore lint/suspicious/noUnnecessaryConditions: defensive fallback preserves the optional provider contract at runtime
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
      // biome-ignore lint/suspicious/noUnnecessaryConditions: defensive fallback preserves the optional feed result contract at runtime
      return feed?.content ?? null;
    }
  );
  return createFetchResult(url, content, title);
}

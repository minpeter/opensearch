import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";

import { getRandomUserAgent } from "../user-agents.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type ReadabilityArticle = NonNullable<ReturnType<Readability["parse"]>>;
type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const JINA_TIMEOUT_MS = 10_000;
const SPARSE_CONTENT_THRESHOLD = 50;

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function getFallbackContent(
  url: string,
  content: string
): Promise<string> {
  if (content.length >= SPARSE_CONTENT_THRESHOLD) {
    return content;
  }

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });

    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    if (error instanceof Error) {
      return content;
    }

    throw error;
  }

  return content;
}

export async function fetchLocalUrl(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: { "User-Agent": getRandomUserAgent() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (url.endsWith(".pdf") || contentType.includes("application/pdf")) {
    const extractedText = await extractPdfContent(await response.arrayBuffer());
    return createFetchResult(url, extractedText);
  }

  const htmlWithoutImages = (await response.text()).replace(IMG_TAG_REGEX, "");

  const doc = new JSDOM(htmlWithoutImages, { url });
  const article: ReadabilityArticle | null = new Readability(
    doc.window.document
  ).parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    linkStyle: "referenced",
  });

  turndown.use(gfm);
  turndown.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });

  const content = await getFallbackContent(
    url,
    turndown.turndown(article?.content ?? "")
  );

  return createFetchResult(url, content, article?.title ?? "");
}

import type { CheerioAPI } from "cheerio/slim";
import {
  isIgnoredSearchEngineUrl,
  normalizeHeuristicUrl,
} from "./scrape-url.ts";
import {
  cleanText,
  dedupeResults,
  normalizeResult,
  truncateText,
} from "./text.ts";
import type { ParsedResult, SearchEngineName } from "./types.ts";

type ScrapeEngineName = Extract<SearchEngineName, "DuckDuckGo">;

interface HeuristicAnchor {
  closest: (selector?: string) => { text: () => string };
  parent: () => { text: () => string; parent: () => { text: () => string } };
  siblings: (selector?: string) => { text: () => string };
  text: () => string;
}

export function extractHeuristicResults(
  $: CheerioAPI,
  engine: ScrapeEngineName
): ParsedResult[] {
  const results: ParsedResult[] = [];

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const normalizedUrl = normalizeHeuristicUrl(
      engine,
      anchor.attr("href") ?? ""
    );

    if (!normalizedUrl || isIgnoredSearchEngineUrl(normalizedUrl, engine)) {
      return;
    }

    const title = cleanText(
      anchor.find("h1, h2, h3, h4").first().text() || anchor.text()
    );
    if (!title) {
      return;
    }

    const normalizedResult = normalizeResult({
      snippet: extractHeuristicSnippet(anchor, title),
      title,
      url: normalizedUrl,
    });

    if (normalizedResult) {
      results.push(normalizedResult);
    }
  });

  return dedupeResults(results);
}

function extractHeuristicSnippet(
  anchor: HeuristicAnchor,
  title: string
): string {
  const candidateTexts = [
    anchor.parent().text(),
    anchor.siblings("p, div, span").text(),
    anchor.closest("article, li, div, section").text(),
    anchor.parent().parent().text(),
  ];

  for (const candidateText of candidateTexts) {
    const snippet = toSnippet(candidateText, title);
    if (snippet) {
      return snippet;
    }
  }

  return toSnippet(cleanText(anchor.text()), title);
}

function toSnippet(text: string, title: string): string {
  const cleanedText = removeLeadingTitle(cleanText(text), title);
  if (!cleanedText) {
    return "";
  }

  return truncateText(cleanedText, 280);
}

function removeLeadingTitle(text: string, title: string): string {
  const escapedTitle = escapeRegExp(title);
  const separatorPattern = "(?:\\s+|\\s*[-:|·–—]\\s*)?";
  const titlePrefixPattern = new RegExp(`^${escapedTitle}${separatorPattern}`);

  let nextText = text;

  while (titlePrefixPattern.test(nextText)) {
    nextText = nextText.replace(titlePrefixPattern, "").trim();
  }

  return nextText;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

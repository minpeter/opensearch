import type { ParsedResult, SearchEngineName, SearchResult } from "./types.ts";

export const MAX_SNIPPET_LENGTH = 280;

const HTML_TAG_PATTERN = /<[^>]*>/gu;

export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stripHtmlTags(text: string): string {
  return cleanText(text.replace(HTML_TAG_PATTERN, ""));
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncatedText = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = truncatedText.lastIndexOf(" ");

  if (lastSpaceIndex <= maxLength / 2) {
    return `${truncatedText}...`;
  }

  return `${truncatedText.slice(0, lastSpaceIndex)}...`;
}

export function normalizeResult(result: ParsedResult): ParsedResult | null {
  const title = cleanText(result.title);
  if (!title) {
    return null;
  }

  const url = result.url.trim();
  if (!url) {
    return null;
  }

  const snippet = truncateText(cleanText(result.snippet), MAX_SNIPPET_LENGTH);
  if (!snippet) {
    return null;
  }

  return { snippet, title, url };
}

export function attachEngine(
  engine: SearchEngineName,
  results: readonly ParsedResult[]
): SearchResult[] {
  return results.map((result) => ({ ...result, engine }));
}

export function dedupeResults(
  results: readonly ParsedResult[]
): ParsedResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

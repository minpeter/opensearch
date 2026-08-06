import type { SearchResult } from "../search/types.ts";
import type { IntrinsicMetrics } from "./types.ts";
import { canonicalUrl, isHttpUrl } from "./url.ts";

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u;
const MIN_TERM_LENGTH = 2;
// Small English stopword set; termCoverage is a coarse relevance proxy, not NLP.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "what",
  "with",
]);

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_PATTERN) ?? [];
  return matches.filter(
    (token) => token.length >= MIN_TERM_LENGTH && !STOPWORDS.has(token)
  );
}

/** Distinct, filtered query terms used for the termCoverage proxy. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))];
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
}

/**
 * Intrinsic heuristics over one result set. `numRequested` is the count passed to
 * the provider; fillRate is clamped to [0,1] because providers self-slice, so
 * over-return is invisible by design. Per-result rates are 0 when there are no
 * results; termCoverage is null when the query yields no usable terms.
 */
export function computeIntrinsic(
  query: string,
  numRequested: number,
  results: readonly SearchResult[]
): IntrinsicMetrics {
  const resultCount = results.length;
  const denom = numRequested > 0 ? numRequested : 1;
  const fillRate = clamp01(resultCount / denom);

  if (resultCount === 0) {
    return {
      avgSnippetLength: 0,
      fillRate,
      resultCount: 0,
      snippetFillRate: 0,
      termCoverage: null,
      titleFillRate: 0,
      uniqueRatio: 1,
      urlValidityRate: 0,
    };
  }

  let snippetCount = 0;
  let titleCount = 0;
  let snippetLengthTotal = 0;
  let validUrlCount = 0;
  const canonicalUrls = new Set<string>();
  let uniqueAccountable = 0;

  for (const result of results) {
    const snippet = result.snippet.trim();
    if (snippet !== "") {
      snippetCount += 1;
      snippetLengthTotal += snippet.length;
    }
    if (result.title.trim() !== "") {
      titleCount += 1;
    }
    if (isHttpUrl(result.url)) {
      validUrlCount += 1;
    }
    const canonical = canonicalUrl(result.url);
    if (canonical !== null) {
      canonicalUrls.add(canonical);
      uniqueAccountable += 1;
    }
  }

  const terms = queryTerms(query);
  let termCoverage: number | null = null;
  if (terms.length > 0) {
    const haystacks = results.map((result) =>
      `${result.title} ${result.snippet}`.toLowerCase()
    );
    const matchedTerms = terms.filter((term) =>
      haystacks.some((hay) => hasWord(hay, term))
    ).length;
    termCoverage = matchedTerms / terms.length;
  }

  return {
    avgSnippetLength:
      snippetCount === 0 ? 0 : snippetLengthTotal / snippetCount,
    fillRate,
    resultCount,
    snippetFillRate: snippetCount / resultCount,
    termCoverage,
    titleFillRate: titleCount / resultCount,
    uniqueRatio:
      uniqueAccountable === 0 ? 1 : canonicalUrls.size / uniqueAccountable,
    urlValidityRate: validUrlCount / resultCount,
  };
}

function hasWord(haystack: string, term: string): boolean {
  let index = haystack.indexOf(term);
  while (index !== -1) {
    const before = index === 0 ? "" : haystack[index - 1];
    const after = haystack[index + term.length] ?? "";
    if (!(isWordChar(before) || isWordChar(after))) {
      return true;
    }
    index = haystack.indexOf(term, index + 1);
  }
  return false;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && char !== "" && WORD_CHAR_PATTERN.test(char);
}

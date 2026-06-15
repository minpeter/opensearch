import type { SearchEngineName, SearchResult } from "../search/types.ts";
import type { GoldenMetrics, IntrinsicMetrics, ProbeOutcome } from "./types.ts";
import { canonicalUrl, isHttpUrl, matchesLabel } from "./url.ts";

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

function dcgAt(relevances: readonly number[], k: number): number {
  let sum = 0;
  const limit = Math.min(k, relevances.length);
  for (let i = 0; i < limit; i += 1) {
    sum += (relevances[i] ?? 0) / Math.log2(i + 2);
  }
  return sum;
}

/**
 * Labeled-relevance metrics for one query. Returns null when the query has no
 * labels so callers exclude it from golden aggregation rather than scoring it 0.
 *
 * Each relevant label is credited at most once, at its first matching position;
 * later results matching an already-credited label score 0. This bounds hits by
 * the label count (so nDCG stays in [0,1]) and avoids rewarding a provider for
 * returning the same relevant domain multiple times. precision uses
 * min(k, resultCount) as the denominator to isolate relevance from fill; recall
 * divides by the label count; nDCG uses binary gains against an ideal ranking.
 */
export function computeGolden(
  results: readonly SearchResult[],
  relevant: readonly string[],
  k: number
): GoldenMetrics | null {
  if (relevant.length === 0) {
    return null;
  }

  const topK = results.slice(0, k);
  const gains: number[] = [];
  const creditedLabels = new Set<number>();
  let positionHits = 0;
  let firstHitRank = 0;

  topK.forEach((result, position) => {
    let creditsNew = false;
    relevant.forEach((label, labelIndex) => {
      if (!creditedLabels.has(labelIndex) && matchesLabel(result.url, label)) {
        creditsNew = true;
        creditedLabels.add(labelIndex);
      }
    });
    gains.push(creditsNew ? 1 : 0);
    if (creditsNew) {
      positionHits += 1;
      if (firstHitRank === 0) {
        firstHitRank = position + 1;
      }
    }
  });

  const denomPrecision = Math.min(k, results.length);
  const idealGains = relevant.map(() => 1);
  const idcg = dcgAt(idealGains, k);

  return {
    hits: creditedLabels.size,
    k,
    mrr: firstHitRank === 0 ? 0 : 1 / firstHitRank,
    ndcgAtK: idcg === 0 ? 0 : dcgAt(gains, k) / idcg,
    precisionAtK: denomPrecision === 0 ? 0 : positionHits / denomPrecision,
    recallAtK: creditedLabels.size / relevant.length,
    relevantCount: relevant.length,
  };
}

/**
 * For one query, map each canonical URL to the set of engines that returned it.
 * Only successful probes with parseable URLs contribute.
 */
export function buildConsensus(
  probesForQuery: readonly ProbeOutcome[]
): Map<string, Set<SearchEngineName>> {
  const consensus = new Map<string, Set<SearchEngineName>>();
  for (const probe of probesForQuery) {
    if (!probe.ok) {
      continue;
    }
    for (const result of probe.results) {
      const canonical = canonicalUrl(result.url);
      if (canonical === null) {
        continue;
      }
      const engines = consensus.get(canonical) ?? new Set<SearchEngineName>();
      engines.add(probe.engine);
      consensus.set(canonical, engines);
    }
  }
  return consensus;
}

/** Engines (excluding `self`) that returned at least one result for this query. */
export function otherParticipatingEngines(
  probesForQuery: readonly ProbeOutcome[],
  self: SearchEngineName
): number {
  const engines = new Set<SearchEngineName>();
  for (const probe of probesForQuery) {
    if (probe.ok && probe.results.length > 0 && probe.engine !== self) {
      engines.add(probe.engine);
    }
  }
  return engines.size;
}

/**
 * Consensus score for one provider on one query: the mean, over its top-k
 * results, of the fraction of OTHER engines that also returned that URL. Returns
 * null when no other engine participated (e.g. a single-provider run) so a lone
 * engine never scores a misleading 1.0.
 */
export function consensusScore(
  results: readonly SearchResult[],
  self: SearchEngineName,
  consensus: Map<string, Set<SearchEngineName>>,
  otherEngineCount: number,
  k: number
): number | null {
  if (otherEngineCount <= 0) {
    return null;
  }
  const topK = results.slice(0, k);
  if (topK.length === 0) {
    return 0;
  }

  let total = 0;
  for (const result of topK) {
    const canonical = canonicalUrl(result.url);
    const engines = canonical === null ? undefined : consensus.get(canonical);
    const agreeing =
      engines === undefined ? 0 : engines.size - (engines.has(self) ? 1 : 0);
    total += clamp01(agreeing / otherEngineCount);
  }
  return total / topK.length;
}

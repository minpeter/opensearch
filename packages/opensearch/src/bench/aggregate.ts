import type { SearchEngineName } from "../search/types.ts";
import {
  buildConsensus,
  computeGolden,
  computeIntrinsic,
  consensusScore,
  otherParticipatingEngines,
} from "./metrics.ts";
import type {
  BenchQuery,
  IntrinsicMetrics,
  ProbeOutcome,
  ProviderReport,
} from "./types.ts";

/** Version of the composite qualityScore formula; bump on any weight/shape change. */
export const QUALITY_SCORE_VERSION = "1.0.0";

/**
 * Base weights for the composite qualityScore. Components that are unavailable
 * (no labels → relevance; single-engine run → consensus) are dropped and the
 * remaining weights are renormalized. Heuristic is always available, so a score
 * is always produced. Asserted to sum to 1 in the test suite.
 */
export const QUALITY_SCORE_WEIGHTS = {
  consensus: 0.2,
  heuristic: 0.3,
  relevance: 0.5,
} as const;

/** Latency percentiles below this sample count are flagged low-confidence. */
const LATENCY_CONFIDENCE_MIN_SAMPLES = 10;

const RATE_LIMIT_MESSAGE_PATTERN = /429|rate.?limit|too many requests/i;

interface Accumulator {
  avgSnippetLengthTotal: number;
  blocked: number;
  consensusCount: number;
  consensusTotal: number;
  fillRateTotal: number;
  // Golden sums over labeled queries.
  labeledQueryCount: number;
  latencies: number[];
  misconfigured: number;
  mrrTotal: number;
  ndcgTotal: number;
  noResults: number;
  precisionTotal: number;
  probeCount: number;
  rate429: number;
  rateLimited: number;
  recallTotal: number;
  // Quality sums over probes that returned at least one result.
  resultProbeCount: number;
  snippetFillTotal: number;
  successCount: number;
  termCoverageCount: number;
  termCoverageTotal: number;
  timedOut: number;
  titleFillTotal: number;
  uniqueRatioTotal: number;
  urlValidityTotal: number;
}

function newAccumulator(): Accumulator {
  return {
    avgSnippetLengthTotal: 0,
    blocked: 0,
    consensusCount: 0,
    consensusTotal: 0,
    fillRateTotal: 0,
    labeledQueryCount: 0,
    latencies: [],
    misconfigured: 0,
    mrrTotal: 0,
    ndcgTotal: 0,
    noResults: 0,
    precisionTotal: 0,
    probeCount: 0,
    rate429: 0,
    rateLimited: 0,
    recallTotal: 0,
    resultProbeCount: 0,
    snippetFillTotal: 0,
    successCount: 0,
    termCoverageCount: 0,
    termCoverageTotal: 0,
    timedOut: 0,
    titleFillTotal: 0,
    uniqueRatioTotal: 0,
    urlValidityTotal: 0,
  };
}

/** Nearest-rank percentile (ceil) over an unsorted sample; 0 for an empty sample. */
export function percentile(
  samples: readonly number[],
  quantile: number
): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(quantile * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

function isRateLimited(probe: ProbeOutcome): boolean {
  if (probe.status === 429) {
    return true;
  }
  return (
    probe.errorKind === "blocked" &&
    RATE_LIMIT_MESSAGE_PATTERN.test(probe.message ?? "")
  );
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function accumulateFailure(acc: Accumulator, probe: ProbeOutcome): void {
  if (probe.status === 429) {
    acc.rate429 += 1;
  }
  if (probe.errorKind === "blocked") {
    acc.blocked += 1;
  }
  if (isRateLimited(probe)) {
    acc.rateLimited += 1;
  }
  if (probe.timedOut) {
    acc.timedOut += 1;
  }
  if (probe.errorKind === "misconfigured") {
    acc.misconfigured += 1;
  }
  if (probe.errorKind === "no-results") {
    acc.noResults += 1;
  }
}

function accumulateQuality(
  acc: Accumulator,
  probe: ProbeOutcome,
  intrinsic: IntrinsicMetrics,
  consensus: Map<string, Set<SearchEngineName>>,
  otherEngines: number,
  topK: number
): void {
  acc.resultProbeCount += 1;
  acc.snippetFillTotal += intrinsic.snippetFillRate;
  acc.titleFillTotal += intrinsic.titleFillRate;
  acc.avgSnippetLengthTotal += intrinsic.avgSnippetLength;
  acc.urlValidityTotal += intrinsic.urlValidityRate;
  acc.uniqueRatioTotal += intrinsic.uniqueRatio;
  if (intrinsic.termCoverage !== null) {
    acc.termCoverageTotal += intrinsic.termCoverage;
    acc.termCoverageCount += 1;
  }
  const score = consensusScore(
    probe.results,
    probe.engine,
    consensus,
    otherEngines,
    topK
  );
  if (score !== null) {
    acc.consensusTotal += score;
    acc.consensusCount += 1;
  }
}

function accumulateGolden(
  acc: Accumulator,
  probe: ProbeOutcome,
  relevant: readonly string[],
  topK: number
): void {
  if (!probe.ok || relevant.length === 0) {
    return;
  }
  const golden = computeGolden(probe.results, relevant, topK);
  if (golden === null) {
    return;
  }
  acc.labeledQueryCount += 1;
  acc.precisionTotal += golden.precisionAtK;
  acc.recallTotal += golden.recallAtK;
  acc.mrrTotal += golden.mrr;
  acc.ndcgTotal += golden.ndcgAtK;
}

function accumulate(
  acc: Accumulator,
  probe: ProbeOutcome,
  relevant: readonly string[],
  numResults: number,
  topK: number,
  consensus: Map<string, Set<SearchEngineName>>,
  otherEngines: number
): void {
  acc.probeCount += 1;

  const intrinsic = computeIntrinsic(probe.query, numResults, probe.results);
  acc.fillRateTotal += intrinsic.fillRate;

  if (probe.ok) {
    acc.successCount += 1;
    acc.latencies.push(probe.latencyMs);
  } else {
    accumulateFailure(acc, probe);
  }

  if (intrinsic.resultCount > 0) {
    accumulateQuality(acc, probe, intrinsic, consensus, otherEngines, topK);
  }

  accumulateGolden(acc, probe, relevant, topK);
}

function meanOrNull(total: number, count: number): number | null {
  return count === 0 ? null : total / count;
}

function compositeQualityScore(
  relevance: number | null,
  consensus: number | null,
  heuristic: number
): number {
  const components: [number, number][] = [
    [QUALITY_SCORE_WEIGHTS.heuristic, heuristic],
  ];
  if (relevance !== null) {
    components.push([QUALITY_SCORE_WEIGHTS.relevance, relevance]);
  }
  if (consensus !== null) {
    components.push([QUALITY_SCORE_WEIGHTS.consensus, consensus]);
  }
  const weightSum = components.reduce((sum, [weight]) => sum + weight, 0);
  if (weightSum === 0) {
    return 0;
  }
  const weighted = components.reduce(
    (sum, [weight, value]) => sum + weight * value,
    0
  );
  return weighted / weightSum;
}

function finalize(engine: SearchEngineName, acc: Accumulator): ProviderReport {
  const failureCount = acc.probeCount - acc.successCount;
  const termCoverage = meanOrNull(acc.termCoverageTotal, acc.termCoverageCount);
  const consensus = meanOrNull(acc.consensusTotal, acc.consensusCount);
  const precision = meanOrNull(acc.precisionTotal, acc.labeledQueryCount);
  const recall = meanOrNull(acc.recallTotal, acc.labeledQueryCount);
  const mrr = meanOrNull(acc.mrrTotal, acc.labeledQueryCount);
  const ndcg = meanOrNull(acc.ndcgTotal, acc.labeledQueryCount);

  const snippetFillRate = ratio(acc.snippetFillTotal, acc.resultProbeCount);
  const titleFillRate = ratio(acc.titleFillTotal, acc.resultProbeCount);
  const urlValidityRate = ratio(acc.urlValidityTotal, acc.resultProbeCount);
  // Average only over available components: when termCoverage is null (query had
  // no usable terms) it is excluded rather than counted as 0, which would bias
  // the heuristic downward.
  const heuristicParts = [snippetFillRate, titleFillRate, urlValidityRate];
  if (termCoverage !== null) {
    heuristicParts.push(termCoverage);
  }
  const heuristic =
    heuristicParts.reduce((sum, value) => sum + value, 0) /
    heuristicParts.length;

  return {
    avgSnippetLength: ratio(acc.avgSnippetLengthTotal, acc.resultProbeCount),
    blockedRate: ratio(acc.blocked, acc.probeCount),
    consensus,
    engine,
    failureCount,
    fillRate: ratio(acc.fillRateTotal, acc.probeCount),
    labeledQueryCount: acc.labeledQueryCount,
    latencyMeanMs: ratio(
      acc.latencies.reduce((sum, value) => sum + value, 0),
      acc.latencies.length
    ),
    latencyP50Ms: percentile(acc.latencies, 0.5),
    latencyP95Ms: percentile(acc.latencies, 0.95),
    latencySampleCount: acc.latencies.length,
    lowConfidenceLatency: acc.latencies.length < LATENCY_CONFIDENCE_MIN_SAMPLES,
    misconfiguredRate: ratio(acc.misconfigured, acc.probeCount),
    mrr,
    ndcgAtK: ndcg,
    noResultsRate: ratio(acc.noResults, acc.probeCount),
    precisionAtK: precision,
    probeCount: acc.probeCount,
    qualityScore: compositeQualityScore(ndcg, consensus, heuristic),
    qualityScoreVersion: QUALITY_SCORE_VERSION,
    rate429Rate: ratio(acc.rate429, acc.probeCount),
    rateLimitRate: ratio(acc.rateLimited, acc.probeCount),
    recallAtK: recall,
    snippetFillRate,
    successCount: acc.successCount,
    successRate: ratio(acc.successCount, acc.probeCount),
    termCoverage,
    timeoutRate: ratio(acc.timedOut, acc.probeCount),
    titleFillRate,
    uniqueRatio: ratio(acc.uniqueRatioTotal, acc.resultProbeCount),
    urlValidityRate,
  };
}

/**
 * Roll probe outcomes up into one report per engine. `topK` is the cutoff for
 * golden/consensus scoring (defaults to numResults). Engines are emitted in the
 * order first seen, then the per-engine accumulators are finalized.
 */
export function aggregateProbes(
  probes: readonly ProbeOutcome[],
  queries: readonly BenchQuery[],
  numResults: number,
  topK: number = numResults
): ProviderReport[] {
  const relevantByQuery = new Map<string, readonly string[]>();
  for (const query of queries) {
    relevantByQuery.set(query.query, query.relevant ?? []);
  }

  const probesByQuery = new Map<string, ProbeOutcome[]>();
  for (const probe of probes) {
    const bucket = probesByQuery.get(probe.query) ?? [];
    bucket.push(probe);
    probesByQuery.set(probe.query, bucket);
  }

  const consensusByQuery = new Map<
    string,
    Map<string, Set<SearchEngineName>>
  >();
  for (const [query, bucket] of probesByQuery) {
    consensusByQuery.set(query, buildConsensus(bucket));
  }

  // A Map preserves first-seen insertion order, so it doubles as the emit order.
  const accumulators = new Map<SearchEngineName, Accumulator>();

  for (const probe of probes) {
    let acc = accumulators.get(probe.engine);
    if (acc === undefined) {
      acc = newAccumulator();
      accumulators.set(probe.engine, acc);
    }
    const bucket = probesByQuery.get(probe.query) ?? [];
    const consensus =
      consensusByQuery.get(probe.query) ??
      new Map<string, Set<SearchEngineName>>();
    const otherEngines = otherParticipatingEngines(bucket, probe.engine);
    accumulate(
      acc,
      probe,
      relevantByQuery.get(probe.query) ?? [],
      numResults,
      topK,
      consensus,
      otherEngines
    );
  }

  return [...accumulators].map(([engine, acc]) => finalize(engine, acc));
}

import type { SearchEngineName } from "../search/types.ts";
import { computeGolden, computeIntrinsic, consensusScore } from "./metrics.ts";
import {
  QUALITY_SCORE_VERSION,
  QUALITY_SCORE_WEIGHTS,
} from "./quality-score.ts";
import type {
  IntrinsicMetrics,
  ProbeOutcome,
  ProviderReport,
} from "./types.ts";

const LATENCY_CONFIDENCE_MIN_SAMPLES = 10;
const RATE_LIMIT_MESSAGE_PATTERN = /429|rate.?limit|too many requests/i;

export type Accumulator = ReturnType<typeof newAccumulator>;

export function newAccumulator() {
  const latencies: number[] = [];

  return {
    avgSnippetLengthTotal: 0,
    blocked: 0,
    consensusCount: 0,
    consensusTotal: 0,
    fillRateTotal: 0,
    labeledQueryCount: 0,
    latencies,
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

export function accumulateProbe(
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

export function finalizeAccumulator(
  engine: SearchEngineName,
  acc: Accumulator,
  percentile: (samples: readonly number[], quantile: number) => number
): ProviderReport {
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
  const heuristic = calculateHeuristic(
    snippetFillRate,
    titleFillRate,
    urlValidityRate,
    termCoverage
  );

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

function calculateHeuristic(
  snippetFillRate: number,
  titleFillRate: number,
  urlValidityRate: number,
  termCoverage: number | null
): number {
  const parts = [snippetFillRate, titleFillRate, urlValidityRate];
  if (termCoverage !== null) {
    parts.push(termCoverage);
  }
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
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
  const weighted = components.reduce(
    (sum, [weight, value]) => sum + weight * value,
    0
  );
  return weighted / weightSum;
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

function meanOrNull(total: number, count: number): number | null {
  return count === 0 ? null : total / count;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

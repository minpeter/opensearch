import {
  QUALITY_SCORE_VERSION,
  QUALITY_SCORE_WEIGHTS,
} from "./quality-score.ts";
import type { BenchReport, BenchReportMeta, ProviderReport } from "./types.ts";

const DEFAULT_PRECISION = 4;

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundNullable(value: number | null, precision: number): number | null {
  return value === null ? null : roundTo(value, precision);
}

/** Round every numeric field so reports compare stably across machines/Node versions. */
export function roundProviderReport(
  report: ProviderReport,
  precision = DEFAULT_PRECISION
): ProviderReport {
  return {
    ...report,
    avgSnippetLength: roundTo(report.avgSnippetLength, precision),
    blockedRate: roundTo(report.blockedRate, precision),
    consensus: roundNullable(report.consensus, precision),
    fillRate: roundTo(report.fillRate, precision),
    latencyMeanMs: roundTo(report.latencyMeanMs, precision),
    latencyP50Ms: roundTo(report.latencyP50Ms, precision),
    latencyP95Ms: roundTo(report.latencyP95Ms, precision),
    misconfiguredRate: roundTo(report.misconfiguredRate, precision),
    mrr: roundNullable(report.mrr, precision),
    ndcgAtK: roundNullable(report.ndcgAtK, precision),
    noResultsRate: roundTo(report.noResultsRate, precision),
    precisionAtK: roundNullable(report.precisionAtK, precision),
    qualityScore: roundTo(report.qualityScore, precision),
    rate429Rate: roundTo(report.rate429Rate, precision),
    rateLimitRate: roundTo(report.rateLimitRate, precision),
    recallAtK: roundNullable(report.recallAtK, precision),
    snippetFillRate: roundTo(report.snippetFillRate, precision),
    successRate: roundTo(report.successRate, precision),
    termCoverage: roundNullable(report.termCoverage, precision),
    timeoutRate: roundTo(report.timeoutRate, precision),
    titleFillRate: roundTo(report.titleFillRate, precision),
    uniqueRatio: roundTo(report.uniqueRatio, precision),
    urlValidityRate: roundTo(report.urlValidityRate, precision),
  };
}

/**
 * Engines that were expected but produced no probes (e.g. no key configured, or
 * explicitly excluded). Empty when no expectation is supplied — "skipped" only
 * makes sense in live mode where the catalog is the reference.
 */
export function computeSkipped(
  reports: readonly ProviderReport[],
  expectedEngines: readonly string[] = []
): string[] {
  const present = new Set<string>(reports.map((report) => report.engine));
  return expectedEngines.filter((name) => !present.has(name));
}

export interface BuildReportInput {
  readonly expectedEngines?: readonly string[];
  readonly generatedAt?: string;
  readonly mode: "offline" | "live";
  readonly numResults: number;
  readonly precision?: number;
  readonly queryCount: number;
  readonly reports: readonly ProviderReport[];
  readonly topK: number;
}

export function buildReport(input: BuildReportInput): BenchReport {
  const precision = input.precision ?? DEFAULT_PRECISION;
  const providers = input.reports.map((report) =>
    roundProviderReport(report, precision)
  );
  const labeledQueryCount = providers.reduce(
    (max, report) => Math.max(max, report.labeledQueryCount),
    0
  );

  const meta: BenchReportMeta = {
    labeledQueryCount,
    mode: input.mode,
    numResults: input.numResults,
    qualityScoreVersion: QUALITY_SCORE_VERSION,
    qualityScoreWeights: QUALITY_SCORE_WEIGHTS,
    queryCount: input.queryCount,
    topK: input.topK,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  };

  return {
    meta,
    providers,
    skipped: computeSkipped(providers, input.expectedEngines),
  };
}

export function toJsonReport(report: BenchReport): string {
  return JSON.stringify(report, null, 2);
}

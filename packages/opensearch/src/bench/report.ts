import { QUALITY_SCORE_VERSION, QUALITY_SCORE_WEIGHTS } from "./aggregate.ts";
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

function engineNames(reports: readonly ProviderReport[]): Set<string> {
  return new Set(reports.map((report) => report.engine));
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
  const present = engineNames(reports);
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

function fmt(value: number): string {
  return value.toFixed(2);
}

function fmtNullable(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function fmtMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function limitTable(reports: readonly ProviderReport[]): string {
  const header =
    "| Engine | Success | Fill | 429 | Blocked | RateLimit | Timeout | Misconfig | NoResults | p50 | p95 |";
  const divider =
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = reports.map((report) => {
    const p50 = report.lowConfidenceLatency
      ? `${fmtMs(report.latencyP50Ms)}*`
      : fmtMs(report.latencyP50Ms);
    const p95 = report.lowConfidenceLatency
      ? `${fmtMs(report.latencyP95Ms)}*`
      : fmtMs(report.latencyP95Ms);
    return `| ${report.engine} | ${fmt(report.successRate)} | ${fmt(report.fillRate)} | ${fmt(report.rate429Rate)} | ${fmt(report.blockedRate)} | ${fmt(report.rateLimitRate)} | ${fmt(report.timeoutRate)} | ${fmt(report.misconfiguredRate)} | ${fmt(report.noResultsRate)} | ${p50} | ${p95} |`;
  });
  return [header, divider, ...rows].join("\n");
}

function qualityTable(reports: readonly ProviderReport[]): string {
  const header =
    "| Engine | Quality | Snippet | Title | URLok | Unique | TermCov | Consensus | P@k | R@k | MRR | nDCG | Labeled |";
  const divider =
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = reports.map(
    (report) =>
      `| ${report.engine} | ${fmt(report.qualityScore)} | ${fmt(report.snippetFillRate)} | ${fmt(report.titleFillRate)} | ${fmt(report.urlValidityRate)} | ${fmt(report.uniqueRatio)} | ${fmtNullable(report.termCoverage)} | ${fmtNullable(report.consensus)} | ${fmtNullable(report.precisionAtK)} | ${fmtNullable(report.recallAtK)} | ${fmtNullable(report.mrr)} | ${fmtNullable(report.ndcgAtK)} | ${report.labeledQueryCount} |`
  );
  return [header, divider, ...rows].join("\n");
}

/** Human-facing markdown comparison, split into LIMIT and QUALITY tables. */
export function toMarkdownTable(report: BenchReport): string {
  const sortedByQuality = [...report.providers].sort(
    (a, b) => b.qualityScore - a.qualityScore
  );
  const lines = [
    `# Provider metrics (${report.meta.mode})`,
    "",
    `Queries: ${report.meta.queryCount} (labeled: ${report.meta.labeledQueryCount}) · numResults: ${report.meta.numResults} · top-k: ${report.meta.topK} · qualityScore v${report.meta.qualityScoreVersion}`,
    ...(report.meta.generatedAt === undefined
      ? []
      : [`Generated: ${report.meta.generatedAt}`]),
    "",
    "## LIMIT",
    "_Rates are fractions of probes. `*` marks latency from fewer than 10 samples (low confidence)._",
    "",
    limitTable(report.providers),
    "",
    "## QUALITY",
    "_Sorted by composite qualityScore. `n/a` means the metric was not applicable (no labels / single-engine run)._",
    "",
    qualityTable(sortedByQuality),
  ];

  if (report.skipped.length > 0) {
    lines.push(
      "",
      "## Skipped",
      `Not measured (no key/config or excluded): ${report.skipped.join(", ")}`
    );
  }

  return lines.join("\n");
}

export interface MetricRegression {
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
  readonly engine: string;
  readonly metric: string;
  readonly tolerance: number;
}

/** Metrics where a DROP beyond tolerance is a regression. */
const HIGHER_IS_BETTER = ["successRate", "fillRate", "qualityScore"] as const;
/** Metrics where a RISE beyond tolerance is a regression. */
const LOWER_IS_BETTER = ["rateLimitRate", "timeoutRate"] as const;

type TrackedMetric =
  | (typeof HIGHER_IS_BETTER)[number]
  | (typeof LOWER_IS_BETTER)[number];

/**
 * Compare a live report against a baseline and flag meaningful drift. Intended
 * for the live monitor only; the offline gate uses an exact golden-file assertion
 * because synthetic fixtures are deterministic.
 */
export function diffBaseline(
  current: BenchReport,
  baseline: BenchReport,
  tolerance = 0.15
): MetricRegression[] {
  const baselineByEngine = new Map(
    baseline.providers.map((report) => [report.engine, report])
  );
  const regressions: MetricRegression[] = [];

  for (const report of current.providers) {
    const before = baselineByEngine.get(report.engine);
    if (before === undefined) {
      continue;
    }
    for (const metric of HIGHER_IS_BETTER) {
      pushRegression(
        regressions,
        report.engine,
        metric,
        before,
        report,
        tolerance,
        true
      );
    }
    for (const metric of LOWER_IS_BETTER) {
      pushRegression(
        regressions,
        report.engine,
        metric,
        before,
        report,
        tolerance,
        false
      );
    }
  }

  return regressions;
}

function pushRegression(
  out: MetricRegression[],
  engine: string,
  metric: TrackedMetric,
  before: ProviderReport,
  current: ProviderReport,
  tolerance: number,
  higherIsBetter: boolean
): void {
  const baselineValue = before[metric];
  const currentValue = current[metric];
  const delta = currentValue - baselineValue;
  const regressed = higherIsBetter ? delta < -tolerance : delta > tolerance;
  if (regressed) {
    out.push({
      baseline: baselineValue,
      current: currentValue,
      delta,
      engine,
      metric,
      tolerance,
    });
  }
}

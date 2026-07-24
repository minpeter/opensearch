import type { BenchReport, ProviderReport } from "./types.ts";

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

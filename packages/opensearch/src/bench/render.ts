import { barChartSvg } from "./bar-chart.ts";
import { scatterSvg, tierListSvg } from "./charts.ts";
import { assignTiers, TIER_COLORS } from "./tiers.ts";
import type { BenchReport } from "./types.ts";

export type ChartName = "tier-list" | "quality" | "limit" | "latency-quality";

function subtitle(report: BenchReport): string {
  const labeled = report.meta.labeledQueryCount;
  return `${report.meta.mode} · ${report.providers.length} providers · ${report.meta.queryCount} queries (${labeled} labeled) · qualityScore v${report.meta.qualityScoreVersion}`;
}

function roundUpTo(value: number, step: number): number {
  if (value <= 0) {
    return step;
  }
  return Math.ceil(value / step) * step;
}

/**
 * Build every chart as an SVG string from a report. Rendering to PNG (for
 * embedding in a PR comment) is done outside via rsvg-convert/resvg.
 */
export function buildCharts(report: BenchReport): Record<ChartName, string> {
  const tiers = assignTiers(report.providers);
  const tierColor = new Map(
    tiers.map((assignment) => [assignment.engine, TIER_COLORS[assignment.tier]])
  );
  const sub = subtitle(report);

  const byQuality = [...report.providers].sort(
    (a, b) => b.qualityScore - a.qualityScore
  );
  const byFill = [...report.providers].sort((a, b) => b.fillRate - a.fillRate);

  const maxLatency = report.providers.reduce(
    (max, provider) => Math.max(max, provider.latencyP50Ms),
    0
  );

  return {
    "latency-quality": scatterSvg({
      points: report.providers.map((provider) => ({
        color: tierColor.get(provider.engine),
        label: provider.engine,
        x: provider.latencyP50Ms,
        y: provider.qualityScore,
      })),
      subtitle: sub,
      title: "Latency vs quality",
      width: 760,
      xLabel: "latency p50 (ms) — lower is better",
      xMax: roundUpTo(maxLatency, 500),
      yLabel: "qualityScore",
      yMax: 1,
    }),
    limit: barChartSvg({
      format: (value) => value.toFixed(2),
      items: byFill.map((provider) => ({
        color: tierColor.get(provider.engine),
        label: provider.engine,
        value: provider.fillRate,
      })),
      max: 1,
      subtitle: sub,
      title: "Limit — fill rate (results returned / requested)",
    }),
    quality: barChartSvg({
      format: (value) => value.toFixed(2),
      items: byQuality.map((provider) => ({
        color: tierColor.get(provider.engine),
        label: provider.engine,
        value: provider.qualityScore,
      })),
      max: 1,
      subtitle: sub,
      title: "Quality — composite qualityScore",
    }),
    "tier-list": tierListSvg(tiers, {
      subtitle: sub,
      title: "Provider tier list (quality × reliability)",
    }),
  };
}

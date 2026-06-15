import { describe, expect, it } from "vitest";
import { barChartSvg, scatterSvg, tierListSvg } from "../charts.ts";
import { buildCharts } from "../render.ts";
import { buildReport } from "../report.ts";
import { assignTiers } from "../tiers.ts";
import type { ProviderReport } from "../types.ts";

function provider(
  engine: ProviderReport["engine"],
  overrides: Partial<ProviderReport>
): ProviderReport {
  return {
    avgSnippetLength: 80,
    blockedRate: 0,
    consensus: 0.3,
    engine,
    failureCount: 0,
    fillRate: 0.8,
    labeledQueryCount: 2,
    latencyMeanMs: 200,
    latencyP50Ms: 200,
    latencyP95Ms: 400,
    latencySampleCount: 3,
    lowConfidenceLatency: true,
    misconfiguredRate: 0,
    mrr: 0.8,
    ndcgAtK: 0.8,
    noResultsRate: 0,
    precisionAtK: 0.5,
    probeCount: 3,
    qualityScore: 0.7,
    qualityScoreVersion: "1.0.0",
    rate429Rate: 0,
    rateLimitRate: 0,
    recallAtK: 0.7,
    snippetFillRate: 1,
    successCount: 3,
    successRate: 1,
    termCoverage: 0.9,
    timeoutRate: 0,
    titleFillRate: 1,
    uniqueRatio: 1,
    urlValidityRate: 1,
    ...overrides,
  };
}

function svgProblems(content: string): string[] {
  const problems: string[] = [];
  if (!content.startsWith("<svg")) {
    problems.push("missing <svg> root");
  }
  if (!content.includes("</svg>")) {
    problems.push("missing </svg> close");
  }
  if (content.includes("NaN")) {
    problems.push("contains NaN");
  }
  if (content.includes("undefined")) {
    problems.push("contains undefined");
  }
  return problems;
}

describe("chart primitives", () => {
  it("renders a bar chart with title and escaped labels", () => {
    const out = barChartSvg({
      items: [
        { label: "Brave & Co", value: 0.9 },
        { label: "Exa", value: 0.6 },
      ],
      title: "Quality",
    });
    expect(svgProblems(out)).toEqual([]);
    expect(out).toContain("Quality");
    expect(out).toContain("Brave &amp; Co");
  });

  it("handles a zero max without producing NaN", () => {
    const out = barChartSvg({
      items: [{ label: "x", value: 0 }],
      max: 0,
      title: "Z",
    });
    expect(svgProblems(out)).toEqual([]);
  });

  it("renders a scatter plot with points", () => {
    const out = scatterSvg({
      points: [{ label: "Brave", x: 200, y: 0.7 }],
      title: "Latency vs quality",
      xLabel: "ms",
      xMax: 1000,
      yLabel: "q",
      yMax: 1,
    });
    expect(svgProblems(out)).toEqual([]);
  });

  it("renders a tier list with all five bands", () => {
    const out = tierListSvg(
      assignTiers([
        provider("Brave", { qualityScore: 0.9, successRate: 1 }),
        provider("DuckDuckGo", { qualityScore: 0.3, successRate: 0.5 }),
      ])
    );
    expect(svgProblems(out)).toEqual([]);
    for (const tier of ["S", "A", "B", "C", "D"]) {
      expect(out).toContain(`>${tier}</text>`);
    }
  });
});

describe("buildCharts", () => {
  it("produces four named, valid charts from a report", () => {
    const report = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [
        provider("Brave", { fillRate: 0.9, qualityScore: 0.85 }),
        provider("Exa", {
          fillRate: 0.5,
          latencyP50Ms: 350,
          qualityScore: 0.6,
        }),
      ],
      topK: 10,
    });
    const charts = buildCharts(report);
    expect(Object.keys(charts).sort()).toEqual([
      "latency-quality",
      "limit",
      "quality",
      "tier-list",
    ]);
    for (const svgContent of Object.values(charts)) {
      expect(svgProblems(svgContent)).toEqual([]);
    }
  });
});

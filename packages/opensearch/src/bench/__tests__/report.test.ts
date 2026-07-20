import { describe, expect, it } from "vitest";
import {
  buildReport,
  diffBaseline,
  roundProviderReport,
  toMarkdownTable,
} from "../report.ts";
import type { ProviderReport } from "../types.ts";

function baseReport(overrides: Partial<ProviderReport>): ProviderReport {
  return {
    avgSnippetLength: 50,
    blockedRate: 0,
    consensus: 0.5,
    engine: "Brave",
    failureCount: 0,
    fillRate: 1,
    labeledQueryCount: 3,
    latencyMeanMs: 100,
    latencyP50Ms: 100,
    latencyP95Ms: 120,
    latencySampleCount: 12,
    lowConfidenceLatency: false,
    misconfiguredRate: 0,
    mrr: 1,
    ndcgAtK: 0.9,
    noResultsRate: 0,
    precisionAtK: 0.8,
    probeCount: 3,
    qualityScore: 0.85,
    qualityScoreVersion: "1.0.0",
    rate429Rate: 0,
    rateLimitRate: 0,
    recallAtK: 0.9,
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

describe("roundProviderReport", () => {
  it("rounds numeric fields and preserves nulls", () => {
    const rounded = roundProviderReport(
      baseReport({ consensus: null, qualityScore: 0.123_456 }),
      4
    );
    expect(rounded.qualityScore).toBe(0.1235);
    expect(rounded.consensus).toBeNull();
  });
});

describe("buildReport", () => {
  it("lists expected engines that produced no probes as skipped", () => {
    const report = buildReport({
      expectedEngines: ["Brave", "Exa", "Tavily"],
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [baseReport({ engine: "Brave" })],
      topK: 10,
    });
    expect(report.skipped).toEqual(["Exa", "Tavily"]);
    expect(report.meta.qualityScoreVersion).toBe("1.0.0");
  });

  it("omits skipped when no expectation is supplied (offline)", () => {
    const report = buildReport({
      mode: "offline",
      numResults: 5,
      queryCount: 3,
      reports: [baseReport({})],
      topK: 5,
    });
    expect(report.skipped).toEqual([]);
    expect(report.meta.generatedAt).toBeUndefined();
  });
});

describe("toMarkdownTable", () => {
  it("renders LIMIT and QUALITY sections with the engine", () => {
    const report = buildReport({
      mode: "offline",
      numResults: 5,
      queryCount: 3,
      reports: [baseReport({})],
      topK: 5,
    });
    const markdown = toMarkdownTable(report);
    expect(markdown).toContain("## LIMIT");
    expect(markdown).toContain("## QUALITY");
    expect(markdown).toContain("Brave");
  });
});

describe("diffBaseline", () => {
  it("flags drops in higher-is-better and rises in lower-is-better metrics", () => {
    const baseline = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [baseReport({ rateLimitRate: 0, successRate: 1 })],
      topK: 10,
    });
    const current = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [baseReport({ rateLimitRate: 0.5, successRate: 0.5 })],
      topK: 10,
    });
    const regressions = diffBaseline(current, baseline, 0.15);
    const metrics = regressions
      .map((r) => r.metric)
      .sort((a, b) => a.localeCompare(b));
    expect(metrics).toEqual(["rateLimitRate", "successRate"]);
  });

  it("returns no regressions within tolerance", () => {
    const report = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [baseReport({})],
      topK: 10,
    });
    expect(diffBaseline(report, report, 0.15)).toEqual([]);
  });

  it("flags a previously healthy provider that disappears from the run", () => {
    const baseline = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [baseReport({ successRate: 1 })],
      topK: 10,
    });
    const current = buildReport({
      mode: "live",
      numResults: 10,
      queryCount: 3,
      reports: [],
      topK: 10,
    });

    expect(diffBaseline(current, baseline)).toEqual([
      expect.objectContaining({
        baseline: 1,
        current: 0,
        engine: "Brave",
        metric: "successRate",
      }),
    ]);
  });
});

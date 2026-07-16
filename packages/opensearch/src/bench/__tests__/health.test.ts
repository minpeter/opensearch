import { describe, expect, it } from "vitest";
import { evaluateMonitorHealth } from "../health.ts";
import { buildReport } from "../report.ts";
import type { ProviderReport } from "../types.ts";

const providerReport = (
  engine: ProviderReport["engine"],
  successRate: number
): ProviderReport => ({
  avgSnippetLength: 10,
  blockedRate: 0,
  consensus: null,
  engine,
  failureCount: Math.round(3 * (1 - successRate)),
  fillRate: successRate,
  labeledQueryCount: 0,
  latencyMeanMs: 100,
  latencyP50Ms: 100,
  latencyP95Ms: 100,
  latencySampleCount: Math.round(3 * successRate),
  lowConfidenceLatency: true,
  misconfiguredRate: 0,
  mrr: null,
  ndcgAtK: null,
  noResultsRate: 0,
  precisionAtK: null,
  probeCount: 3,
  qualityScore: successRate,
  qualityScoreVersion: "2",
  rate429Rate: 0,
  rateLimitRate: 0,
  recallAtK: null,
  snippetFillRate: successRate,
  successCount: Math.round(3 * successRate),
  successRate,
  termCoverage: null,
  timeoutRate: 0,
  titleFillRate: successRate,
  uniqueRatio: successRate,
  urlValidityRate: successRate,
});

const reportWith = (providers: ProviderReport[]) =>
  buildReport({
    mode: "live",
    numResults: 10,
    queryCount: 3,
    reports: providers,
    topK: 10,
  });

describe("evaluateMonitorHealth", () => {
  it("fails when every measured provider is unavailable", () => {
    const health = evaluateMonitorHealth(
      reportWith([
        providerReport("Firecrawl", 0),
        providerReport("Parallel", 0),
      ])
    );

    expect(health.healthy).toBe(false);
    expect(health.healthyProviders).toEqual([]);
    expect(health.reasons[0]).toContain("0 provider(s)");
  });

  it("passes when at least one provider meets the per-provider floor", () => {
    const health = evaluateMonitorHealth(
      reportWith([
        providerReport("Firecrawl", 2 / 3),
        providerReport("Parallel", 0),
      ])
    );

    expect(health.healthy).toBe(true);
    expect(health.healthyProviders).toEqual(["Firecrawl"]);
  });

  it("fails rather than treating an empty catalog as green", () => {
    const health = evaluateMonitorHealth(reportWith([]));

    expect(health.healthy).toBe(false);
    expect(health.reasons).toContain("No providers were measured.");
  });
});

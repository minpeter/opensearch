import { describe, expect, it } from "vitest";
import {
  assignTiers,
  groupByTier,
  type Tier,
  tierFor,
  tierScoreOf,
} from "../tiers.ts";
import type { ProviderReport } from "../types.ts";

function report(
  engine: ProviderReport["engine"],
  qualityScore: number,
  successRate: number
): ProviderReport {
  return {
    avgSnippetLength: 0,
    blockedRate: 0,
    consensus: null,
    engine,
    failureCount: 0,
    fillRate: 0,
    labeledQueryCount: 0,
    latencyMeanMs: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    latencySampleCount: 0,
    lowConfidenceLatency: true,
    misconfiguredRate: 0,
    mrr: null,
    ndcgAtK: null,
    noResultsRate: 0,
    precisionAtK: null,
    probeCount: 1,
    qualityScore,
    qualityScoreVersion: "1.0.0",
    rate429Rate: 0,
    rateLimitRate: 0,
    recallAtK: null,
    snippetFillRate: 0,
    successCount: 0,
    successRate,
    termCoverage: null,
    timeoutRate: 0,
    titleFillRate: 0,
    uniqueRatio: 1,
    urlValidityRate: 0,
  };
}

describe("tierFor", () => {
  it("maps scores to tiers at the documented cutoffs", () => {
    const cases: [number, Tier][] = [
      [0.9, "S"],
      [0.8, "S"],
      [0.7, "A"],
      [0.5, "B"],
      [0.4, "C"],
      [0.1, "D"],
    ];
    for (const [score, tier] of cases) {
      expect(tierFor(score)).toBe(tier);
    }
  });
});

describe("tierScoreOf", () => {
  it("halves quality at zero reliability and preserves it at full reliability", () => {
    expect(tierScoreOf(report("Brave", 1, 0))).toBeCloseTo(0.5);
    expect(tierScoreOf(report("Brave", 1, 1))).toBeCloseTo(1);
    expect(tierScoreOf(report("Brave", 0.8, 0.5))).toBeCloseTo(0.6);
  });

  it("demotes an unreliable provider below a reliable lower-quality one", () => {
    const flaky = tierScoreOf(report("Exa", 0.95, 0.2)); // 0.95*0.6=0.57 -> B
    const steady = tierScoreOf(report("Brave", 0.75, 1)); // 0.75 -> A
    expect(steady).toBeGreaterThan(flaky);
    expect(tierFor(steady)).toBe("A");
    expect(tierFor(flaky)).toBe("B");
  });
});

describe("assignTiers / groupByTier", () => {
  it("sorts best-first and groups in tier order", () => {
    const assignments = assignTiers([
      report("DuckDuckGo", 0.4, 0.5),
      report("Brave", 0.9, 1),
      report("Exa", 0.7, 1),
    ]);
    expect(assignments.map((a) => a.engine)).toEqual([
      "Brave",
      "Exa",
      "DuckDuckGo",
    ]);
    expect(assignments[0]?.tier).toBe("S");

    const grouped = groupByTier(assignments);
    expect(grouped.map((g) => g.tier)).toEqual(["S", "A", "B", "C", "D"]);
    expect(grouped[0]?.members[0]?.engine).toBe("Brave");
  });
});

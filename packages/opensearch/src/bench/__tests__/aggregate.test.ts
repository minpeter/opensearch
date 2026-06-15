import { describe, expect, it } from "vitest";
import type { SearchEngineName } from "../../search/types.ts";
import {
  aggregateProbes,
  percentile,
  QUALITY_SCORE_WEIGHTS,
} from "../aggregate.ts";
import type { BenchQuery, ProbeOutcome } from "../types.ts";

function okProbe(
  engine: SearchEngineName,
  query: string,
  urls: string[],
  latencyMs: number
): ProbeOutcome {
  return {
    engine,
    latencyMs,
    ok: true,
    query,
    results: urls.map((url) => ({
      engine,
      snippet: "A relevant snippet.",
      title: "Title",
      url,
    })),
    timedOut: false,
  };
}

describe("percentile", () => {
  it("uses nearest-rank (ceil) and clamps to the sample range", () => {
    const samples = [10, 20, 30, 40];
    expect(percentile(samples, 0.5)).toBe(20);
    expect(percentile(samples, 0.95)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([42], 0.95)).toBe(42);
  });
});

describe("aggregateProbes rate-limit and failure rates", () => {
  const queries: BenchQuery[] = [{ query: "q1" }, { query: "q2" }];

  it("detects 429 by status and by blocked + message", () => {
    const probes: ProbeOutcome[] = [
      {
        engine: "Brave",
        errorKind: "blocked",
        latencyMs: 5,
        message: "Brave fetch failed with status 429",
        ok: false,
        query: "q1",
        results: [],
        status: 429,
        timedOut: false,
      },
      {
        engine: "Exa",
        errorKind: "blocked",
        latencyMs: 5,
        message: "Exa rate limit exceeded",
        ok: false,
        query: "q1",
        results: [],
        timedOut: false,
      },
    ];
    const [brave, exa] = aggregateProbes(probes, [{ query: "q1" }], 10);
    expect(brave?.rate429Rate).toBe(1);
    expect(brave?.rateLimitRate).toBe(1);
    // No status, but message marks it as rate-limited.
    expect(exa?.rate429Rate).toBe(0);
    expect(exa?.rateLimitRate).toBe(1);
    expect(exa?.blockedRate).toBe(1);
  });

  it("computes fillRate over all probes, scoring failures as 0", () => {
    const probes: ProbeOutcome[] = [
      okProbe("Brave", "q1", ["https://a.com", "https://b.com"], 100),
      {
        engine: "Brave",
        errorKind: "no-results",
        latencyMs: 50,
        message: "No Results",
        ok: false,
        query: "q2",
        results: [],
        timedOut: false,
      },
    ];
    const [brave] = aggregateProbes(probes, queries, 10);
    // q1 fill = 2/10 = 0.2, q2 fill = 0 -> mean 0.1
    expect(brave?.fillRate).toBeCloseTo(0.1);
    expect(brave?.successRate).toBe(0.5);
    expect(brave?.noResultsRate).toBe(0.5);
    // Latency percentiles only over the one successful probe.
    expect(brave?.latencySampleCount).toBe(1);
    expect(brave?.latencyP50Ms).toBe(100);
  });

  it("flags timeouts and excludes them from latency samples", () => {
    const probes: ProbeOutcome[] = [
      {
        engine: "Tavily",
        errorKind: "transient",
        latencyMs: 8000,
        message:
          "Tavily fetch failed: The operation was aborted due to timeout",
        ok: false,
        query: "q1",
        results: [],
        timedOut: true,
      },
    ];
    const [tavily] = aggregateProbes(probes, [{ query: "q1" }], 10);
    expect(tavily?.timeoutRate).toBe(1);
    expect(tavily?.latencySampleCount).toBe(0);
  });
});

describe("aggregateProbes quality score", () => {
  it("renormalizes weights when relevance and consensus are unavailable", () => {
    // Single engine, no labels: only the heuristic component survives, so the
    // composite equals the heuristic mean and is never an inflated 1.0.
    const probes = [okProbe("Brave", "q1", ["https://a.com"], 100)];
    const [brave] = aggregateProbes(probes, [{ query: "q1" }], 10);
    expect(brave?.consensus).toBeNull();
    expect(brave?.ndcgAtK).toBeNull();
    const heuristic =
      ((brave?.snippetFillRate ?? 0) +
        (brave?.titleFillRate ?? 0) +
        (brave?.urlValidityRate ?? 0) +
        (brave?.termCoverage ?? 0)) /
      4;
    expect(brave?.qualityScore).toBeCloseTo(heuristic);
  });

  it("keeps the documented weight vector summing to 1", () => {
    const sum =
      QUALITY_SCORE_WEIGHTS.consensus +
      QUALITY_SCORE_WEIGHTS.heuristic +
      QUALITY_SCORE_WEIGHTS.relevance;
    expect(sum).toBeCloseTo(1);
  });
});

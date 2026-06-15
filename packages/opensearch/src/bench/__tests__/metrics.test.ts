import { describe, expect, it } from "vitest";
import type { SearchEngineName, SearchResult } from "../../search/types.ts";
import {
  buildConsensus,
  computeGolden,
  computeIntrinsic,
  consensusScore,
  queryTerms,
} from "../metrics.ts";
import type { ProbeOutcome } from "../types.ts";

function result(
  engine: SearchEngineName,
  url: string,
  title = "Title",
  snippet = "A snippet."
): SearchResult {
  return { engine, snippet, title, url };
}

function okProbe(
  engine: SearchEngineName,
  query: string,
  results: SearchResult[]
): ProbeOutcome {
  return { engine, latencyMs: 100, ok: true, query, results, timedOut: false };
}

describe("queryTerms", () => {
  it("drops stopwords and short tokens, de-duplicates", () => {
    expect(queryTerms("the rust async runtime async")).toEqual([
      "rust",
      "async",
      "runtime",
    ]);
  });
});

describe("computeIntrinsic", () => {
  it("clamps fillRate to 1 even when a provider over-returns", () => {
    const results = [
      result("Brave", "https://a.com"),
      result("Brave", "https://b.com"),
      result("Brave", "https://c.com"),
    ];
    expect(computeIntrinsic("query", 2, results).fillRate).toBe(1);
  });

  it("reports zeroed metrics and null termCoverage for an empty set", () => {
    const metrics = computeIntrinsic("rust", 5, []);
    expect(metrics.fillRate).toBe(0);
    expect(metrics.snippetFillRate).toBe(0);
    expect(metrics.uniqueRatio).toBe(1);
    expect(metrics.termCoverage).toBeNull();
  });

  it("counts empty snippets, invalid URLs, and duplicate canonical URLs", () => {
    const results = [
      result("Brave", "https://tokio.rs/", "Tokio", "Async runtime"),
      result("Brave", "https://tokio.rs", "Tokio dup", "Async runtime"),
      result("Brave", "http://example.com/x", "Empty", ""),
      result("Brave", "ftp://files.example.com", "Mirror", "Mirror"),
    ];
    const metrics = computeIntrinsic("async runtime", 5, results);
    expect(metrics.snippetFillRate).toBeCloseTo(3 / 4);
    expect(metrics.urlValidityRate).toBeCloseTo(3 / 4);
    // 3 parseable (ftp excluded), 2 distinct canonical -> 2/3.
    expect(metrics.uniqueRatio).toBeCloseTo(2 / 3);
    expect(metrics.termCoverage).toBe(1);
  });

  it("uses word boundaries for termCoverage (no substring inflation)", () => {
    const results = [result("Brave", "https://a.com", "Category list", "x")];
    expect(computeIntrinsic("cat", 1, results).termCoverage).toBe(0);
  });
});

describe("computeGolden", () => {
  it("returns null when the query has no labels", () => {
    expect(computeGolden([result("Brave", "https://a.com")], [], 5)).toBeNull();
  });

  it("keeps nDCG within [0,1] when a label is matched more than once", () => {
    const results = [
      result("Brave", "https://tokio.rs"),
      result("Brave", "https://docs.rs/tokio"),
      result("Brave", "https://other.com"),
      result("Brave", "https://blog.com"),
      result("Brave", "https://tokio.rs/tutorial"),
    ];
    const golden = computeGolden(results, ["tokio.rs", "docs.rs"], 5);
    expect(golden).not.toBeNull();
    expect(golden?.ndcgAtK).toBeLessThanOrEqual(1);
    expect(golden?.ndcgAtK).toBe(1);
    expect(golden?.hits).toBe(2);
    expect(golden?.recallAtK).toBe(1);
    // 2 credited positions over min(5,5).
    expect(golden?.precisionAtK).toBeCloseTo(2 / 5);
    expect(golden?.mrr).toBe(1);
  });

  it("computes MRR from the first hit rank", () => {
    const results = [
      result("Brave", "https://miss.com"),
      result("Brave", "https://tokio.rs"),
    ];
    expect(computeGolden(results, ["tokio.rs"], 5)?.mrr).toBeCloseTo(1 / 2);
  });
});

describe("consensus", () => {
  const probesForQuery = [
    okProbe("Brave", "q", [
      result("Brave", "https://a.com"),
      result("Brave", "https://b.com"),
    ]),
    okProbe("Exa", "q", [result("Exa", "https://a.com")]),
    okProbe("DuckDuckGo", "q", [result("DuckDuckGo", "https://a.com")]),
  ];

  it("counts the engines that returned each canonical URL", () => {
    const consensus = buildConsensus(probesForQuery);
    expect(consensus.get("a.com")?.size).toBe(3);
    expect(consensus.get("b.com")?.size).toBe(1);
  });

  it("excludes self and normalizes by other participating engines", () => {
    const consensus = buildConsensus(probesForQuery);
    // Brave top-2: a.com agreed by Exa+DDG (2/2=1), b.com by none (0). mean=0.5
    const score = consensusScore(
      [result("Brave", "https://a.com"), result("Brave", "https://b.com")],
      "Brave",
      consensus,
      2,
      5
    );
    expect(score).toBeCloseTo(0.5);
  });

  it("returns null when no other engine participated", () => {
    const consensus = buildConsensus([
      okProbe("Brave", "q", [result("Brave", "https://a.com")]),
    ]);
    expect(
      consensusScore(
        [result("Brave", "https://a.com")],
        "Brave",
        consensus,
        0,
        5
      )
    ).toBeNull();
  });
});

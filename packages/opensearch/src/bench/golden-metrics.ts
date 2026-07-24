import type { SearchResult } from "../search/types.ts";
import type { GoldenMetrics } from "./types.ts";
import { matchesLabel } from "./url.ts";

function dcgAt(relevances: readonly number[], k: number): number {
  let sum = 0;
  const limit = Math.min(k, relevances.length);
  for (let i = 0; i < limit; i += 1) {
    sum += (relevances[i] ?? 0) / Math.log2(i + 2);
  }
  return sum;
}

/**
 * Labeled-relevance metrics for one query. Returns null when the query has no
 * labels so callers exclude it from golden aggregation rather than scoring it 0.
 *
 * Each relevant label is credited at most once, at its first matching position;
 * later results matching an already-credited label score 0. This bounds hits by
 * the label count (so nDCG stays in [0,1]) and avoids rewarding a provider for
 * returning the same relevant domain multiple times. precision uses
 * min(k, resultCount) as the denominator to isolate relevance from fill; recall
 * divides by the label count; nDCG uses binary gains against an ideal ranking.
 */
export function computeGolden(
  results: readonly SearchResult[],
  relevant: readonly string[],
  k: number
): GoldenMetrics | null {
  if (relevant.length === 0) {
    return null;
  }

  const topK = results.slice(0, k);
  const gains: number[] = [];
  const creditedLabels = new Set<number>();
  let positionHits = 0;
  let firstHitRank = 0;

  topK.forEach((result, position) => {
    let creditsNew = false;
    relevant.forEach((label, labelIndex) => {
      if (!creditedLabels.has(labelIndex) && matchesLabel(result.url, label)) {
        creditsNew = true;
        creditedLabels.add(labelIndex);
      }
    });
    gains.push(creditsNew ? 1 : 0);
    if (creditsNew) {
      positionHits += 1;
      if (firstHitRank === 0) {
        firstHitRank = position + 1;
      }
    }
  });

  const denomPrecision = Math.min(k, results.length);
  const idealGains = relevant.map(() => 1);
  const idcg = dcgAt(idealGains, k);

  return {
    hits: creditedLabels.size,
    k,
    mrr: firstHitRank === 0 ? 0 : 1 / firstHitRank,
    ndcgAtK: idcg === 0 ? 0 : dcgAt(gains, k) / idcg,
    precisionAtK: denomPrecision === 0 ? 0 : positionHits / denomPrecision,
    recallAtK: creditedLabels.size / relevant.length,
    relevantCount: relevant.length,
  };
}

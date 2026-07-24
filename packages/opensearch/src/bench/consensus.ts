import type { SearchEngineName, SearchResult } from "../search/types.ts";
import type { ProbeOutcome } from "./types.ts";
import { canonicalUrl } from "./url.ts";

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
}

/**
 * For one query, map each canonical URL to the set of engines that returned it.
 * Only successful probes with parseable URLs contribute.
 */
export function buildConsensus(
  probesForQuery: readonly ProbeOutcome[]
): Map<string, Set<SearchEngineName>> {
  const consensus = new Map<string, Set<SearchEngineName>>();
  for (const probe of probesForQuery) {
    if (!probe.ok) {
      continue;
    }
    for (const result of probe.results) {
      const canonical = canonicalUrl(result.url);
      if (canonical === null) {
        continue;
      }
      const engines = consensus.get(canonical) ?? new Set<SearchEngineName>();
      engines.add(probe.engine);
      consensus.set(canonical, engines);
    }
  }
  return consensus;
}

/** Engines (excluding `self`) that returned at least one result for this query. */
export function otherParticipatingEngines(
  probesForQuery: readonly ProbeOutcome[],
  self: SearchEngineName
): number {
  const engines = new Set<SearchEngineName>();
  for (const probe of probesForQuery) {
    if (probe.ok && probe.results.length > 0 && probe.engine !== self) {
      engines.add(probe.engine);
    }
  }
  return engines.size;
}

/**
 * Consensus score for one provider on one query: the mean, over its top-k
 * results, of the fraction of OTHER engines that also returned that URL. Returns
 * null when no other engine participated (e.g. a single-provider run) so a lone
 * engine never scores a misleading 1.0.
 */
export function consensusScore(
  results: readonly SearchResult[],
  self: SearchEngineName,
  consensus: Map<string, Set<SearchEngineName>>,
  otherEngineCount: number,
  k: number
): number | null {
  if (otherEngineCount <= 0) {
    return null;
  }
  const topK = results.slice(0, k);
  if (topK.length === 0) {
    return 0;
  }

  let total = 0;
  for (const result of topK) {
    const canonical = canonicalUrl(result.url);
    const engines = canonical === null ? undefined : consensus.get(canonical);
    const agreeing =
      engines === undefined ? 0 : engines.size - (engines.has(self) ? 1 : 0);
    total += clamp01(agreeing / otherEngineCount);
  }
  return total / topK.length;
}

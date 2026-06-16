import type { SearchEngineName } from "../search/types.ts";
import type { Accumulator } from "./aggregate-accumulator.ts";
import {
  accumulateProbe,
  finalizeAccumulator,
  newAccumulator,
} from "./aggregate-accumulator.ts";
import { buildConsensus, otherParticipatingEngines } from "./metrics.ts";
import type { BenchQuery, ProbeOutcome, ProviderReport } from "./types.ts";

export function percentile(
  samples: readonly number[],
  quantile: number
): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(quantile * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

export function aggregateProbes(
  probes: readonly ProbeOutcome[],
  queries: readonly BenchQuery[],
  numResults: number,
  topK: number = numResults
): ProviderReport[] {
  const relevantByQuery = new Map<string, readonly string[]>();
  for (const query of queries) {
    relevantByQuery.set(query.query, query.relevant ?? []);
  }

  const probesByQuery = new Map<string, ProbeOutcome[]>();
  for (const probe of probes) {
    const bucket = probesByQuery.get(probe.query) ?? [];
    bucket.push(probe);
    probesByQuery.set(probe.query, bucket);
  }

  const consensusByQuery = new Map<
    string,
    Map<string, Set<SearchEngineName>>
  >();
  for (const [query, bucket] of probesByQuery) {
    consensusByQuery.set(query, buildConsensus(bucket));
  }

  const accumulators = new Map<SearchEngineName, Accumulator>();

  for (const probe of probes) {
    let acc = accumulators.get(probe.engine);
    if (acc === undefined) {
      acc = newAccumulator();
      accumulators.set(probe.engine, acc);
    }
    const bucket = probesByQuery.get(probe.query) ?? [];
    const consensus =
      consensusByQuery.get(probe.query) ??
      new Map<string, Set<SearchEngineName>>();
    const otherEngines = otherParticipatingEngines(bucket, probe.engine);
    accumulateProbe(
      acc,
      probe,
      relevantByQuery.get(probe.query) ?? [],
      numResults,
      topK,
      consensus,
      otherEngines
    );
  }

  return [...accumulators].map(([engine, acc]) =>
    finalizeAccumulator(engine, acc, percentile)
  );
}

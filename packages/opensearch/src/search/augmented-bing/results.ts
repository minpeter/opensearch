import type { SearchResult } from "../types.ts";
import type { ProviderOutcome } from "./failure.ts";

const BING_HEAD_RESULT_COUNT = 3;

export function getOutcomeResults(
  outcome: ProviderOutcome | undefined
): SearchResult[] {
  if (outcome?.status === "fulfilled") {
    return outcome.value;
  }

  return [];
}

export function mergeBingFirstResults(
  bingResults: readonly SearchResult[],
  supplementalResultGroups: readonly SearchResult[][],
  numResults: number
): SearchResult[] {
  const bingHead = bingResults.slice(0, BING_HEAD_RESULT_COUNT);
  const bingTail = bingResults.slice(BING_HEAD_RESULT_COUNT);
  const firstSupplementalResults = supplementalResultGroups.flatMap(
    ([firstResult]) => (firstResult ? [firstResult] : [])
  );
  const remainingSupplementalResults = interleaveResultGroups(
    supplementalResultGroups.map((group) => group.slice(1))
  );

  return dedupeSearchResults([
    ...bingHead,
    ...firstSupplementalResults,
    ...bingTail,
    ...remainingSupplementalResults,
  ]).slice(0, numResults);
}

function dedupeSearchResults(results: readonly SearchResult[]): SearchResult[] {
  const seenUrls = new Set<string>();
  const dedupedResults: SearchResult[] = [];

  for (const result of results) {
    if (seenUrls.has(result.url)) {
      continue;
    }

    seenUrls.add(result.url);
    dedupedResults.push(result);
  }

  return dedupedResults;
}

function interleaveResultGroups(
  groups: readonly SearchResult[][]
): SearchResult[] {
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  const interleavedResults: SearchResult[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (result) {
        interleavedResults.push(result);
      }
    }
  }

  return interleavedResults;
}

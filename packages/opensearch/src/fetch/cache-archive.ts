import {
  type ArchiveCandidate,
  type ArchiveFetcher,
  dynamicArchiveCandidates,
  staticArchiveCandidates,
} from "./archive-candidates.ts";

export interface ArchiveFetchResult {
  readonly candidate: ArchiveCandidate;
  readonly response: Response;
}

export async function fetchArchiveFallback(
  rawUrl: string,
  fetcher: ArchiveFetcher = fetch
): Promise<ArchiveFetchResult | null> {
  const staticResult = await tryArchiveCandidates(
    staticArchiveCandidates(rawUrl),
    fetcher
  );
  if (staticResult) {
    return staticResult;
  }
  return tryArchiveCandidates(
    await dynamicArchiveCandidates(rawUrl, fetcher),
    fetcher
  );
}

async function tryArchiveCandidates(
  candidates: readonly ArchiveCandidate[],
  fetcher: ArchiveFetcher
): Promise<ArchiveFetchResult | null> {
  for (const candidate of candidates) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: archive candidates are tried sequentially to stop after the first success
      const response = await fetcher(candidate.url);
      if (response?.ok) {
        return { candidate, response };
      }
      await response?.body?.cancel();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  return null;
}

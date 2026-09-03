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
  fetcher: ArchiveFetcher = (url, requestSignal) =>
    fetch(url, { signal: requestSignal }),
  signal?: AbortSignal
): Promise<ArchiveFetchResult | null> {
  const staticResult = await tryArchiveCandidates(
    staticArchiveCandidates(rawUrl),
    fetcher,
    signal
  );
  if (staticResult) {
    return staticResult;
  }
  return tryArchiveCandidates(
    await dynamicArchiveCandidates(rawUrl, fetcher, signal),
    fetcher,
    signal
  );
}

async function tryArchiveCandidates(
  candidates: readonly ArchiveCandidate[],
  fetcher: ArchiveFetcher,
  signal?: AbortSignal
): Promise<ArchiveFetchResult | null> {
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    try {
      // biome-ignore lint/performance/noAwaitInLoops: archive candidates are tried sequentially to stop after the first success
      const response = await fetcher(candidate.url, signal);
      if (response?.ok) {
        return { candidate, response };
      }
      await response?.body?.cancel();
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  return null;
}

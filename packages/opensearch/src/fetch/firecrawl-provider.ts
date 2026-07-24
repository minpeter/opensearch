import type { EnvironmentReader } from "../environment.ts";
import { fetchFirecrawlUrl } from "../providers/firecrawl/client.ts";
import { getHttpStatus } from "../providers/shared/error.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type FetchFallback = (url: string) => Promise<FetchResult>;
type FetchFallbackObserver = (url: string, error: Error) => void;

export async function fetchUrlViaFirecrawl(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult> {
  const result = await fetchFirecrawlUrl(url, DEFAULT_MAX_CHARACTERS, env);
  return createFetchResult(url, result.content, result.title);
}

export function fetchUrlsViaFirecrawl(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader,
  fallback: FetchFallback | undefined,
  maxConcurrency: number,
  onFallback?: FetchFallbackObserver
): Promise<FetchResult[]> {
  return mapWithConcurrency(urls, maxConcurrency, async (url) => {
    try {
      const result = await fetchFirecrawlUrl(url, maxCharacters, env);
      return createFetchResult(url, result.content, result.title);
    } catch (error) {
      if (!(error instanceof Error) || getHttpStatus(error) === 451) {
        throw error;
      }
      if (fallback) {
        onFallback?.(url, error);
        return fallback(url);
      }
      throw error;
    }
  });
}

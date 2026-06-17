import type { EnvironmentReader } from "../environment.ts";
import {
  fetchFirecrawlUrl,
  isFirecrawlEnabled,
} from "../providers/firecrawl/client.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type FetchFallback = (url: string) => Promise<FetchResult>;

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
  fallback?: FetchFallback
): Promise<FetchResult[]> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        const result = await fetchFirecrawlUrl(url, maxCharacters, env);
        return createFetchResult(url, result.content, result.title);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        if (fallback) {
          return fallback(url);
        }
        throw error;
      }
    })
  );
}

export async function tryFetchUrlViaFirecrawl(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult | null> {
  if (!isFirecrawlEnabled(env)) {
    return null;
  }

  try {
    return await fetchUrlViaFirecrawl(url, env);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

export async function tryFetchUrlsViaFirecrawl(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader,
  fallback?: FetchFallback
): Promise<FetchResult[] | null> {
  if (!isFirecrawlEnabled(env)) {
    return null;
  }

  try {
    return await fetchUrlsViaFirecrawl(urls, maxCharacters, env, fallback);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

import type { EnvironmentReader } from "../environment.ts";
import {
  fetchFirecrawlUrl,
  fetchFirecrawlUrls,
  isFirecrawlEnabled,
} from "../providers/firecrawl/client.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export async function fetchUrlViaFirecrawl(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult> {
  const result = await fetchFirecrawlUrl(url, DEFAULT_MAX_CHARACTERS, env);
  return createFetchResult(url, result.content, result.title);
}

export async function fetchUrlsViaFirecrawl(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader
): Promise<FetchResult[]> {
  const results = await fetchFirecrawlUrls(urls, maxCharacters, env);

  return urls.map((url, index) => {
    const result = results[index];
    if (!result) {
      throw new Error("Firecrawl scrape returned an unexpected response shape");
    }
    return createFetchResult(url, result.content, result.title);
  });
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
  env: EnvironmentReader
): Promise<FetchResult[] | null> {
  if (!isFirecrawlEnabled(env)) {
    return null;
  }

  try {
    return await fetchUrlsViaFirecrawl(urls, maxCharacters, env);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

import { createFetchResult, type FetchResult } from "../../result.ts";

export const SEARCH_PATH = "/search";

export function queryValue(url: URL): string | null {
  return url.searchParams.get("q") ?? url.searchParams.get("query");
}

export function searchResult(
  url: string,
  title: string,
  content: string,
  _profileUsed?: string,
  _name?: string
): FetchResult {
  return createFetchResult(url, content, title);
}

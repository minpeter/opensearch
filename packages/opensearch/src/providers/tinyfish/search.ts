import { z } from "zod";

import type { TinyFishApiKeyPool } from "./api-key-pool.ts";
import { requestTinyFishJson } from "./http.ts";

const TINYFISH_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";

const tinyFishSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      snippet: z.string(),
      title: z.string(),
      url: z.string(),
    })
  ),
});

export interface TinyFishSearchResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export async function searchTinyFish(
  query: string,
  apiKeyPool?: TinyFishApiKeyPool,
  signal?: AbortSignal
): Promise<TinyFishSearchResult[]> {
  const url = new URL(TINYFISH_SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("page", "0");

  const response = await requestTinyFishJson(
    "search",
    (apiKey, requestSignal) =>
      fetch(url.toString(), {
        headers: { "X-API-Key": apiKey },
        method: "GET",
        signal: requestSignal,
      }),
    { apiKeyPool, signal }
  );
  const parsed = tinyFishSearchResponseSchema.parse(response);

  return parsed.results.map((result) => ({
    snippet: result.snippet,
    title: result.title,
    url: result.url,
  }));
}

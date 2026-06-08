import { z } from "zod";

import type { TinyFishApiKeyPool } from "./api-key-pool.ts";
import { requestTinyFishJson, TINYFISH_TIMEOUT_MS } from "./http.ts";

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
  apiKeyPool?: TinyFishApiKeyPool
): Promise<TinyFishSearchResult[]> {
  const url = new URL(TINYFISH_SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("page", "0");

  const response = await requestTinyFishJson(
    "search",
    (apiKey) =>
      fetch(url.toString(), {
        headers: { "X-API-Key": apiKey },
        method: "GET",
        signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
      }),
    apiKeyPool
  );
  const parsed = tinyFishSearchResponseSchema.parse(response);

  return parsed.results.map((result) => ({
    snippet: result.snippet,
    title: result.title,
    url: result.url,
  }));
}

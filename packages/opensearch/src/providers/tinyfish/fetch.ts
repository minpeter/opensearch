import { z } from "zod";

import type { TinyFishApiKeyPool } from "./api-key-pool.ts";
import { requestTinyFishJson, TINYFISH_TIMEOUT_MS } from "./http.ts";

const TINYFISH_FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";

const tinyFishFetchResponseSchema = z.object({
  errors: z
    .array(
      z.object({
        error: z.string(),
        status: z.number().optional(),
        url: z.string(),
      })
    )
    .default([]),
  results: z.array(
    z.object({
      final_url: z.string().optional(),
      text: z.string(),
      title: z.string().optional(),
      url: z.string(),
    })
  ),
});

type TinyFishFetchResponse = z.infer<typeof tinyFishFetchResponseSchema>;
type TinyFishFetchItem = TinyFishFetchResponse["results"][number];

export interface TinyFishFetchResult {
  readonly content: string;
  readonly title: string;
}

export async function fetchTinyFishUrls(
  urls: readonly string[],
  apiKeyPool?: TinyFishApiKeyPool
): Promise<TinyFishFetchResult[]> {
  const response = await requestTinyFishJson(
    "fetch",
    (apiKey) =>
      fetch(TINYFISH_FETCH_ENDPOINT, {
        body: JSON.stringify({
          format: "markdown",
          image_links: false,
          links: false,
          urls,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
      }),
    apiKeyPool
  );
  const parsed = tinyFishFetchResponseSchema.parse(response);
  const resultsByUrl = mapTinyFishResultsByUrl(parsed.results);

  return urls.map((url) => toFetchResult(url, parsed, resultsByUrl));
}

function mapTinyFishResultsByUrl(
  results: readonly TinyFishFetchItem[]
): Map<string, TinyFishFetchItem> {
  const resultsByUrl = new Map<string, TinyFishFetchItem>();

  for (const result of results) {
    resultsByUrl.set(result.url, result);

    if (result.final_url) {
      resultsByUrl.set(result.final_url, result);
    }
  }

  return resultsByUrl;
}

function toFetchResult(
  url: string,
  response: TinyFishFetchResponse,
  resultsByUrl: ReadonlyMap<string, TinyFishFetchItem>
): TinyFishFetchResult {
  const result = resultsByUrl.get(url);

  if (!result) {
    const error = response.errors.find((candidate) => candidate.url === url);
    throw new Error(
      error
        ? `TinyFish fetch failed for ${url}: ${error.error}`
        : "TinyFish fetch returned an unexpected response shape"
    );
  }

  return {
    content: result.text,
    title: result.title ?? "",
  };
}

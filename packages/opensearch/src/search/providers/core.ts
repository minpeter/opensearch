import { z } from "zod";
import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  createTinyFishApiKeyPool,
  type TinyFishApiKeyPool,
} from "../../providers/tinyfish/api-key-pool.ts";
import { searchTinyFish } from "../../providers/tinyfish/search.ts";
import { getRandomUserAgent } from "../../user-agents.ts";
import { createPooledSearchProvider } from "../api-key-provider.ts";
import { getErrorMessage, SearchEngineError } from "../errors.ts";
import {
  createSearchUrl,
  fetchSearchText,
  parseJsonResponse,
  REQUEST_TIMEOUT_MS,
} from "../http.ts";
import { attachEngine, dedupeResults, normalizeResult } from "../text.ts";
import type { ParsedResult, SearchProvider } from "../types.ts";

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          description: z.string().optional(),
          snippet: z.string().optional(),
          title: z.string().optional(),
          url: z.string().optional(),
        })
      ),
    })
    .optional(),
});

export function createTinyFishSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider | null {
  const apiKeyPool = createTinyFishApiKeyPool(env);
  if (!apiKeyPool.hasApiKeys()) {
    return null;
  }

  return createTinyFishProviderWithPool(apiKeyPool);
}

function createTinyFishProviderWithPool(
  apiKeyPool: TinyFishApiKeyPool
): SearchProvider {
  return {
    name: "TinyFish",
    async search(query: string, numResults: number) {
      let results: Awaited<ReturnType<typeof searchTinyFish>>;

      try {
        results = await searchTinyFish(query, apiKeyPool);
      } catch (error) {
        throw new SearchEngineError(
          "TinyFish",
          "transient",
          `TinyFish search failed: ${getErrorMessage(error)}`
        );
      }

      if (results.length === 0) {
        throw new SearchEngineError("TinyFish", "no-results", "No Results");
      }

      return attachEngine("TinyFish", results.slice(0, numResults));
    },
  };
}

export function createBraveSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider | null {
  return createPooledSearchProvider({
    apiKeyPool: getApiKeyPool("BRAVE_SEARCH_API_KEY", env),
    name: "Brave",
    async searchWithApiKey(apiKey, query, numResults) {
      const response = await fetchSearchText({
        authFailureStatuses: new Set([401]),
        engine: "Brave",
        init: {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": getRandomUserAgent(),
            "X-Subscription-Token": apiKey,
          },
          method: "GET",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: createSearchUrl("https://api.search.brave.com/res/v1/web/search", {
          count: String(numResults),
          q: query,
          search_lang: "en",
        }),
      });

      return attachEngine("Brave", parseBraveResults(response));
    },
  });
}

function parseBraveResults(responseBody: string): ParsedResult[] {
  const parsed = braveResponseSchema.safeParse(
    parseJsonResponse(responseBody, "Brave")
  );
  if (!parsed.success) {
    throw new SearchEngineError(
      "Brave",
      "transient",
      "Brave returned an unexpected response shape"
    );
  }

  if (!parsed.data.web) {
    throw new SearchEngineError(
      "Brave",
      "transient",
      "Brave returned an unexpected response shape"
    );
  }

  const results = parsed.data.web.results
    .map((item) =>
      normalizeResult({
        snippet: item.description ?? item.snippet ?? "",
        title: item.title ?? "",
        url: item.url ?? "",
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError("Brave", "no-results", "No Results");
  }

  return dedupeResults(results);
}

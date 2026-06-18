import { z } from "zod";
import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { getRandomUserAgent } from "../../user-agents.ts";
import { createPooledSearchProvider } from "../api-key-provider.ts";
import { SearchEngineError } from "../errors.ts";
import {
  fetchSearchText,
  parseJsonResponse,
  REQUEST_TIMEOUT_MS,
} from "../http.ts";
import { attachEngine, dedupeResults, normalizeResult } from "../text.ts";
import type { ParsedResult, SearchProvider } from "../types.ts";

const EXA_HIGHLIGHT_MAX_CHARACTERS = 280;

const exaResponseSchema = z.object({
  results: z.array(
    z.object({
      highlights: z.array(z.string()).optional(),
      snippet: z.string().optional(),
      text: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    })
  ),
});

export function createExaSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider | null {
  return createPooledSearchProvider({
    apiKeyPool: getApiKeyPool("EXA_API_KEY", env),
    name: "Exa",
    async searchWithApiKey(apiKey, query, numResults) {
      const response = await fetchSearchText({
        authFailureStatuses: new Set([401, 402]),
        engine: "Exa",
        init: {
          body: JSON.stringify({
            contents: {
              highlights: { maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS },
            },
            numResults,
            query,
            type: "auto",
          }),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getRandomUserAgent(),
            "x-api-key": apiKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: "https://api.exa.ai/search",
      });

      return attachEngine("Exa", parseExaResults(response));
    },
  });
}

function parseExaResults(responseBody: string): ParsedResult[] {
  const parsed = exaResponseSchema.safeParse(
    parseJsonResponse(responseBody, "Exa")
  );
  if (!parsed.success) {
    throw new SearchEngineError(
      "Exa",
      "transient",
      "Exa returned an unexpected response shape"
    );
  }

  const results = parsed.data.results
    .map((item) =>
      normalizeResult({
        snippet: item.highlights?.[0] ?? item.text ?? item.snippet ?? "",
        title: item.title ?? "",
        url: item.url ?? "",
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError("Exa", "no-results", "No Results");
  }

  return dedupeResults(results);
}

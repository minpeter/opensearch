import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  isFirecrawlEnabled,
  searchFirecrawl,
} from "../../providers/firecrawl/client.ts";
import { getHttpStatus } from "../../providers/shared/error.ts";
import { getErrorMessage, SearchEngineError } from "../errors.ts";
import { attachEngine, dedupeResults, normalizeResult } from "../text.ts";
import type { ParsedResult, SearchProvider } from "../types.ts";

export function createFirecrawlSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider | null {
  if (!isFirecrawlEnabled(env)) {
    return null;
  }

  return {
    name: "Firecrawl",
    async search(query: string, numResults: number) {
      let results: ParsedResult[];

      try {
        results = (
          await searchFirecrawl(query, numResults, env, {
            useApiKey: false,
          })
        )
          .map((result) => normalizeResult(result))
          .filter((result): result is ParsedResult => result !== null);
      } catch (error) {
        const status = getHttpStatus(error);
        // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
        throw new SearchEngineError(
          "Firecrawl",
          classifyFirecrawlFailure(status),
          `Firecrawl search failed: ${getErrorMessage(error)}`,
          status === undefined ? { cause: error } : { cause: error, status }
        );
      }

      if (results.length === 0) {
        throw new SearchEngineError("Firecrawl", "no-results", "No Results");
      }

      return attachEngine("Firecrawl", dedupeResults(results)).slice(
        0,
        numResults
      );
    },
  };
}

function classifyFirecrawlFailure(status: number | undefined) {
  if (status === 401 || status === 402) {
    return "misconfigured" as const;
  }
  if (status === 403 || status === 451) {
    return "blocked" as const;
  }
  return "transient" as const;
}

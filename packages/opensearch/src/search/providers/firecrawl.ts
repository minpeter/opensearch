import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  isFirecrawlEnabled,
  searchFirecrawl,
} from "../../providers/firecrawl/client.ts";
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
        throw new SearchEngineError(
          "Firecrawl",
          "transient",
          `Firecrawl search failed: ${getErrorMessage(error)}`
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

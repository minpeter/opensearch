import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  createScrapeSearchProvider,
  SCRAPE_SEARCH_ENGINES,
} from "../scrape.ts";
import type { SearchProvider } from "../types.ts";
import { createAugmentedBingFailure } from "./augmented-bing/failure.ts";
import { createAugmentedBingSupplementalProviders } from "./augmented-bing/providers.ts";
import {
  getOutcomeResults,
  mergeBingFirstResults,
} from "./augmented-bing/results.ts";

export function createAugmentedBingProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider {
  const bingProvider = createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.Bing);
  const supplementalProviders = createAugmentedBingSupplementalProviders(env);

  return {
    name: "Bing",
    async search(query: string, numResults: number) {
      const outcomes = await Promise.allSettled(
        [bingProvider, ...supplementalProviders].map((provider) =>
          provider.search(query, numResults)
        )
      );
      const [bingOutcome, ...supplementalOutcomes] = outcomes;
      const bingResults = getOutcomeResults(bingOutcome);
      const supplementalResultGroups = supplementalOutcomes.map((outcome) =>
        getOutcomeResults(outcome)
      );
      const mergedResults = mergeBingFirstResults(
        bingResults,
        supplementalResultGroups,
        numResults
      );

      if (mergedResults.length > 0) {
        return mergedResults;
      }

      throw createAugmentedBingFailure(outcomes);
    },
  };
}

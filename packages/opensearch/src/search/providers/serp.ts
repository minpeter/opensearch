import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { compactProviders } from "../api-key-provider.ts";
import type { SearchProvider } from "../types.ts";
import { createBrightDataProvider } from "./serp/bright-data.ts";
import { createDataForSeoProvider } from "./serp/dataforseo.ts";
import { createGoogleCustomSearchProvider } from "./serp/google-custom-search.ts";
import { createScrapingBeeProvider } from "./serp/scrapingbee.ts";
import { createSearchApiProvider } from "./serp/searchapi.ts";
import { createSerpApiProvider } from "./serp/serpapi.ts";
import { createSerperProvider } from "./serp/serper.ts";

export function createSerpProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  const googleEngineId = env.read("GOOGLE_CUSTOM_SEARCH_ENGINE_ID")?.trim();
  const brightDataZone =
    env.read("BRIGHT_DATA_SERP_ZONE")?.trim() ||
    env.read("OPENSEARCH_BRIGHT_DATA_SERP_ZONE")?.trim();

  return compactProviders([
    createSerperProvider(env),
    createSerpApiProvider(env),
    createDataForSeoProvider(env),
    ...(googleEngineId
      ? [createGoogleCustomSearchProvider(googleEngineId, env)]
      : []),
    ...(brightDataZone ? [createBrightDataProvider(brightDataZone, env)] : []),
    createScrapingBeeProvider(env),
    createSearchApiProvider(env),
  ]);
}

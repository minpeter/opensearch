import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import { getBaseUrl, parseArrayFromAnyPath } from "../../api-provider-utils.ts";
import { createSearchUrl } from "../../http.ts";
import type { SearchProvider } from "../../types.ts";

export function createBrightDataProvider(
  zone: string,
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("BRIGHT_DATA_SERP_API_KEY", env),
    name: "BrightData",
    buildRequest: (apiKey, query, numResults) => ({
      body: {
        format: "json",
        method: "GET",
        url: createSearchUrl("https://www.google.com/search", {
          num: String(numResults),
          q: query,
        }),
        zone,
      },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_BRIGHT_DATA_SERP_URL",
        "https://api.brightdata.com/request",
        env
      ),
    }),
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [
        ["organic"],
        ["organic_results"],
        ["results"],
      ]),
  });
}

import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import { getBaseUrl, parseArrayFromAnyPath } from "../../api-provider-utils.ts";
import { createSearchUrl } from "../../http.ts";
import type { SearchProvider } from "../../types.ts";

export function createScrapingBeeProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SCRAPINGBEE_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_SCRAPINGBEE_URL",
          "https://app.scrapingbee.com/api/v1/store/google",
          env
        ),
        {
          api_key: apiKey,
          nb_results: String(numResults),
          search: query,
        }
      ),
    }),
    name: "ScrapingBee",
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["organic_results"], ["results"]]),
  });
}

import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import {
  getBaseUrl,
  parseCommonResultArray,
} from "../../api-provider-utils.ts";
import { createSearchUrl } from "../../http.ts";
import type { SearchProvider } from "../../types.ts";

export function createSerpApiProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SERPAPI_API_KEY", env),
    name: "SerpAPI",
    buildRequest: (apiKey, query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_SERPAPI_URL",
          "https://serpapi.com/search.json",
          env
        ),
        {
          api_key: apiKey,
          engine: "google",
          num: String(numResults),
          q: query,
        }
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["organic_results"]),
  });
}

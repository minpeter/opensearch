import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import {
  getBaseUrl,
  parseCommonResultArray,
} from "../../api-provider-utils.ts";
import { createSearchUrl } from "../../http.ts";
import type { SearchProvider } from "../../types.ts";

export function createSearchApiProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SEARCHAPI_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_SEARCHAPI_URL",
          "https://www.searchapi.io/api/v1/search",
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
    name: "SearchAPI",
    parse: (payload) => parseCommonResultArray(payload, ["organic_results"]),
  });
}

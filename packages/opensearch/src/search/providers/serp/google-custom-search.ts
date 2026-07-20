import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import {
  getBaseUrl,
  parseCommonResultArray,
} from "../../api-provider-utils.ts";
import { createSearchUrl } from "../../http.ts";
import type { SearchProvider } from "../../types.ts";

export function createGoogleCustomSearchProvider(
  engineId: string,
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("GOOGLE_CUSTOM_SEARCH_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_GOOGLE_CSE_URL",
          "https://customsearch.googleapis.com/customsearch/v1",
          env
        ),
        {
          cx: engineId,
          key: apiKey,
          num: String(Math.min(numResults, 10)),
          q: query,
        }
      ),
    }),
    name: "Google",
    parse: (payload) => parseCommonResultArray(payload, ["items"]),
  });
}

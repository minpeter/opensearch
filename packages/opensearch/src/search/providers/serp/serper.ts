import { getApiKeyPool } from "../../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledJsonSearchProvider } from "../../api-key-provider.ts";
import {
  getBaseUrl,
  parseCommonResultArray,
} from "../../api-provider-utils.ts";
import type { SearchProvider } from "../../types.ts";

export function createSerperProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SERPER_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      body: { num: numResults, q: query },
      headers: { "X-API-KEY": apiKey },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_SERPER_URL",
        "https://google.serper.dev/search",
        env
      ),
    }),
    name: "Serper",
    parse: (payload) => parseCommonResultArray(payload, ["organic"]),
  });
}

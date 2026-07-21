import { getCredentialPairPool } from "../../../credentials/credential-pairs.ts";
import type { EnvironmentReader } from "../../../environment.ts";
import { createPooledCredentialPairSearchProvider } from "../../api-key-provider.ts";
import {
  createBasicAuthHeader,
  createJsonSearchProvider,
  getBaseUrl,
  parseArrayFromAnyPath,
} from "../../api-provider-utils.ts";
import type { SearchProvider } from "../../types.ts";

export function createDataForSeoProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledCredentialPairSearchProvider({
    credentialPairPool: getCredentialPairPool(
      "DATAFORSEO_LOGIN",
      "DATAFORSEO_PASSWORD",
      env
    ),
    name: "DataForSEO",
    searchWithCredentials(credentials, query, numResults) {
      const [login, password] = credentials;
      return createJsonSearchProvider({
        buildRequest: (requestQuery, requestNumResults) => ({
          body: [
            {
              depth: requestNumResults,
              keyword: requestQuery,
              language_code: "en",
              location_code: 2840,
            },
          ],
          headers: { Authorization: createBasicAuthHeader(login, password) },
          method: "POST",
          url: getBaseUrl(
            "OPENSEARCH_DATAFORSEO_URL",
            "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
            env
          ),
        }),
        name: "DataForSEO",
        parse: (payload) =>
          parseArrayFromAnyPath(payload, [
            ["tasks", "0", "result", "0", "items"],
            ["items"],
          ]),
      }).search(query, numResults);
    },
  });
}

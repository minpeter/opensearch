import { getApiKeyPool } from "../credentials/api-key-pool.ts";
import {
  type CredentialPair,
  getCredentialPairPool,
} from "../credentials/credential-pairs.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  compactProviders,
  createPooledCredentialPairSearchProvider,
  createPooledJsonSearchProvider,
} from "./api-key-provider.ts";
import {
  createBasicAuthHeader,
  createJsonSearchProvider,
  getBaseUrl,
  parseArrayFromAnyPath,
  parseCommonResultArray,
} from "./api-provider-utils.ts";
import { createSearchUrl } from "./http.ts";
import type { SearchProvider } from "./types.ts";

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

function createSerperProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SERPER_API_KEY", env),
    name: "Serper",
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
    parse: (payload) => parseCommonResultArray(payload, ["organic"]),
  });
}

function createSerpApiProvider(env: EnvironmentReader): SearchProvider | null {
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

function createDataForSeoProvider(
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
      return createDataForSeoProviderWithCredentials(credentials, env).search(
        query,
        numResults
      );
    },
  });
}

function createDataForSeoProviderWithCredentials(
  credentials: CredentialPair,
  env: EnvironmentReader
): SearchProvider {
  const [login, password] = credentials;
  return createJsonSearchProvider({
    name: "DataForSEO",
    buildRequest: (query, numResults) => ({
      body: [
        {
          depth: numResults,
          keyword: query,
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
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [
        ["tasks", "0", "result", "0", "items"],
        ["items"],
      ]),
  });
}

function createGoogleCustomSearchProvider(
  engineId: string,
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("GOOGLE_CUSTOM_SEARCH_API_KEY", env),
    name: "Google",
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
    parse: (payload) => parseCommonResultArray(payload, ["items"]),
  });
}

function createBrightDataProvider(
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

function createScrapingBeeProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SCRAPINGBEE_API_KEY", env),
    name: "ScrapingBee",
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
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["organic_results"], ["results"]]),
  });
}

function createSearchApiProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("SEARCHAPI_API_KEY", env),
    name: "SearchAPI",
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
    parse: (payload) => parseCommonResultArray(payload, ["organic_results"]),
  });
}

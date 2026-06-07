import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createBasicAuthHeader,
  createJsonSearchProvider,
  getBaseUrl,
  getEnvPair,
  getEnvPool,
  parseArrayFromAnyPath,
  parseCommonResultArray,
} from "./api-provider-utils.ts";
import { createSearchUrl } from "./http.ts";
import type { SearchProvider } from "./types.ts";

export function createSerpProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  const dataForSeoCredentials = getEnvPair(
    "DATAFORSEO_LOGIN",
    "DATAFORSEO_PASSWORD",
    env
  );
  const googleCredentials = getEnvPair(
    "GOOGLE_CUSTOM_SEARCH_API_KEY",
    "GOOGLE_CUSTOM_SEARCH_ENGINE_ID",
    env
  );
  const brightDataZone =
    env.read("BRIGHT_DATA_SERP_ZONE")?.trim() ||
    env.read("OPENSEARCH_BRIGHT_DATA_SERP_ZONE")?.trim();

  return [
    ...getEnvPool("SERPER_API_KEY", env).map((apiKey) =>
      createSerperProvider(apiKey, env)
    ),
    ...getEnvPool("SERPAPI_API_KEY", env).map((apiKey) =>
      createSerpApiProvider(apiKey, env)
    ),
    ...(dataForSeoCredentials
      ? [createDataForSeoProvider(dataForSeoCredentials, env)]
      : []),
    ...(googleCredentials
      ? [createGoogleCustomSearchProvider(googleCredentials, env)]
      : []),
    ...(brightDataZone
      ? getEnvPool("BRIGHT_DATA_SERP_API_KEY", env).map((apiKey) =>
          createBrightDataProvider(apiKey, brightDataZone, env)
        )
      : []),
    ...getEnvPool("SCRAPINGBEE_API_KEY", env).map((apiKey) =>
      createScrapingBeeProvider(apiKey, env)
    ),
    ...getEnvPool("SEARCHAPI_API_KEY", env).map((apiKey) =>
      createSearchApiProvider(apiKey, env)
    ),
  ];
}

function createSerperProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Serper",
    buildRequest: (query, numResults) => ({
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

function createSerpApiProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "SerpAPI",
    buildRequest: (query, numResults) => ({
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
  credentials: readonly [string, string],
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
  credentials: readonly [string, string],
  env: EnvironmentReader
): SearchProvider {
  const [apiKey, engineId] = credentials;
  return createJsonSearchProvider({
    name: "Google",
    buildRequest: (query, numResults) => ({
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
  apiKey: string,
  zone: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "BrightData",
    buildRequest: (query, numResults) => ({
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
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "ScrapingBee",
    buildRequest: (query, numResults) => ({
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
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "SearchAPI",
    buildRequest: (query, numResults) => ({
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

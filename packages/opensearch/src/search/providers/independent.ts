import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  compactProviders,
  createPooledJsonSearchProvider,
} from "../api-key-provider.ts";
import {
  createJsonSearchProvider,
  getBaseUrl,
  parseArrayFromAnyPath,
  parseCommonResultArray,
  requireTrustedProviderBaseUrl,
} from "../api-provider-utils.ts";
import { createSearchUrl } from "../http.ts";
import type { SearchProvider } from "../types.ts";

export function createIndependentProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return [
    ...compactProviders([
      createKagiProvider("KAGI_API_KEY", env),
      createKagiProvider("KAGI_API_TOKEN", env),
      createMojeekProvider(env),
    ]),
    ...createSearxngProviders(env),
  ];
}

function createKagiProvider(
  envName: string,
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool(envName, env),
    buildRequest: (apiKey, query, numResults) => ({
      headers: { Authorization: `Bot ${apiKey}` },
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_KAGI_URL",
          "https://kagi.com/api/v1/search",
          env
        ),
        {
          limit: String(numResults),
          q: query,
        }
      ),
    }),
    name: "Kagi",
    parse: (payload) => parseCommonResultArray(payload, ["data"]),
  });
}

function createMojeekProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("MOJEEK_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl(
          "OPENSEARCH_MOJEEK_URL",
          "https://www.mojeek.com/search",
          env
        ),
        {
          api_key: apiKey,
          fmt: "json",
          q: query,
          s: String(numResults),
        }
      ),
    }),
    name: "Mojeek",
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["response", "results"], ["results"]]),
  });
}

function createSearxngProviders(env: EnvironmentReader): SearchProvider[] {
  return (env.read("OPENSEARCH_SEARXNG_URLS") ?? "")
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(createSearxngProvider);
}

function createSearxngProvider(baseUrl: string): SearchProvider {
  return createJsonSearchProvider({
    buildRequest: (query) => ({
      method: "GET",
      url: createSearchUrl(
        new URL(
          "/search",
          requireTrustedProviderBaseUrl("OPENSEARCH_SEARXNG_URLS", baseUrl)
        ).toString(),
        {
          format: "json",
          language: "en-US",
          q: query,
          safesearch: "1",
        }
      ),
    }),
    name: "SearxNG",
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

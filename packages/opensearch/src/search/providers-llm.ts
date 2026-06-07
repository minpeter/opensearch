import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createJsonSearchProvider,
  getBaseUrl,
  getEnvPool,
  parseArrayFromAnyPath,
  parseCommonResultArray,
} from "./api-provider-utils.ts";
import { createSearchUrl } from "./http.ts";
import { createJinaProviders } from "./providers-jina.ts";
import type { SearchProvider } from "./types.ts";

const PERPLEXITY_AUTH_FAILURE_STATUSES = new Set([401, 402, 403]);

export function createLlmNativeProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return [
    ...getEnvPool("TAVILY_API_KEY", env).map((apiKey) =>
      createTavilyProvider(apiKey, env)
    ),
    ...getEnvPool("FIRECRAWL_API_KEY", env).map((apiKey) =>
      createFirecrawlProvider(apiKey, env)
    ),
    ...getEnvPool("PARALLEL_API_KEY", env).map((apiKey) =>
      createParallelProvider(apiKey, env)
    ),
    ...getEnvPool("YOU_API_KEY", env).map((apiKey) =>
      createYouProvider(apiKey, env)
    ),
    ...getEnvPool("PERPLEXITY_API_KEY", env).map((apiKey) =>
      createPerplexityProvider(apiKey, env)
    ),
    ...getEnvPool("VALYU_API_KEY", env).map((apiKey) =>
      createValyuProvider(apiKey, env)
    ),
    ...getEnvPool("LINKUP_API_KEY", env).map((apiKey) =>
      createLinkupProvider(apiKey, env)
    ),
    ...createJinaProviders(env),
  ];
}

function createTavilyProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Tavily",
    buildRequest: (query, numResults) => ({
      body: { max_results: numResults, query },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_TAVILY_URL",
        "https://api.tavily.com/search",
        env
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

function createFirecrawlProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Firecrawl",
    buildRequest: (query, numResults) => ({
      body: { limit: numResults, query },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_FIRECRAWL_URL",
        "https://api.firecrawl.dev/v2/search",
        env
      ),
    }),
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["data", "web"], ["data"], ["results"]]),
  });
}

function createParallelProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Parallel",
    buildRequest: (query, numResults) => ({
      body: {
        max_chars_total: Math.max(numResults, 1) * 1200,
        objective: query,
        search_queries: [query],
      },
      headers: { "x-api-key": apiKey },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_PARALLEL_URL",
        "https://api.parallel.ai/v1/search",
        env
      ),
    }),
    parse: (payload) => parseArrayFromAnyPath(payload, [["results"], ["data"]]),
  });
}

function createYouProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "You",
    buildRequest: (query, numResults) => ({
      headers: { "X-API-Key": apiKey },
      method: "GET",
      url: createSearchUrl(
        getBaseUrl("OPENSEARCH_YOU_URL", "https://ydc-index.io/v1/search", env),
        {
          count: String(numResults),
          query,
        }
      ),
    }),
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [
        ["results", "web"],
        ["hits"],
        ["results"],
      ]),
  });
}

function createPerplexityProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Perplexity",
    buildRequest: (query, numResults) => ({
      authFailureStatuses: PERPLEXITY_AUTH_FAILURE_STATUSES,
      body: { max_results: numResults, query },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_PERPLEXITY_URL",
        "https://api.perplexity.ai/search",
        env
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

function createValyuProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Valyu",
    buildRequest: (query, numResults) => ({
      body: { max_num_results: numResults, query },
      headers: { "X-API-Key": apiKey },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_VALYU_URL",
        "https://api.valyu.ai/v1/search",
        env
      ),
    }),
    parse: (payload) => parseArrayFromAnyPath(payload, [["results"], ["data"]]),
  });
}

function createLinkupProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return createJsonSearchProvider({
    name: "Linkup",
    buildRequest: (query, numResults) => ({
      body: {
        depth: "standard",
        outputType: "searchResults",
        q: query,
        limit: numResults,
      },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_LINKUP_URL",
        "https://api.linkup.so/v1/search",
        env
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

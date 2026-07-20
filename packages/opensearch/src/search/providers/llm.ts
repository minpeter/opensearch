import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { isFirecrawlEnabled } from "../../providers/firecrawl/client.ts";
import {
  compactProviders,
  createPooledJsonSearchProvider,
} from "../api-key-provider.ts";
import {
  getBaseUrl,
  parseArrayFromAnyPath,
  parseCommonResultArray,
} from "../api-provider-utils.ts";
import { createSearchUrl } from "../http.ts";
import type { SearchProvider } from "../types.ts";
import { createJinaProviders } from "./jina.ts";

const PERPLEXITY_AUTH_FAILURE_STATUSES = new Set([401, 402, 403]);

export function createLlmNativeProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return [
    ...compactProviders([
      createTavilyProvider(env),
      createFirecrawlProvider(env),
      createParallelProvider(env),
      createYouProvider(env),
      createPerplexityProvider(env),
      createValyuProvider(env),
      createLinkupProvider(env),
    ]),
    ...createJinaProviders(env),
  ];
}

function createTavilyProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("TAVILY_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      body: { max_results: numResults, query },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_TAVILY_URL",
        "https://api.tavily.com/search",
        env
      ),
    }),
    name: "Tavily",
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

function createFirecrawlProvider(
  env: EnvironmentReader
): SearchProvider | null {
  if (!isFirecrawlEnabled(env)) {
    return null;
  }

  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("FIRECRAWL_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      body: { limit: numResults, query },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_FIRECRAWL_URL",
        "https://api.firecrawl.dev/v2/search",
        env
      ),
    }),
    name: "Firecrawl",
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["data", "web"], ["data"], ["results"]]),
  });
}

function createParallelProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("PARALLEL_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
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
    name: "Parallel",
    parse: (payload) => parseArrayFromAnyPath(payload, [["results"], ["data"]]),
  });
}

function createYouProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("YOU_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
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
    name: "You",
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [
        ["results", "web"],
        ["hits"],
        ["results"],
      ]),
  });
}

function createPerplexityProvider(
  env: EnvironmentReader
): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("PERPLEXITY_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
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
    name: "Perplexity",
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

function createValyuProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("VALYU_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      body: { max_num_results: numResults, query },
      headers: { "X-API-Key": apiKey },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_VALYU_URL",
        "https://api.valyu.ai/v1/search",
        env
      ),
    }),
    name: "Valyu",
    parse: (payload) => parseArrayFromAnyPath(payload, [["results"], ["data"]]),
  });
}

function createLinkupProvider(env: EnvironmentReader): SearchProvider | null {
  return createPooledJsonSearchProvider({
    apiKeyPool: getApiKeyPool("LINKUP_API_KEY", env),
    buildRequest: (apiKey, query, numResults) => ({
      body: {
        depth: "standard",
        limit: numResults,
        outputType: "searchResults",
        q: query,
      },
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      url: getBaseUrl(
        "OPENSEARCH_LINKUP_URL",
        "https://api.linkup.so/v1/search",
        env
      ),
    }),
    name: "Linkup",
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}

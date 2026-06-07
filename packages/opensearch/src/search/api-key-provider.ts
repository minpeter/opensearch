import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import type {
  CredentialPair,
  CredentialPairPool,
} from "../credentials/credential-pairs.ts";
import {
  createJsonSearchProvider,
  type JsonProviderRequest,
} from "./api-provider-utils.ts";
import { SearchEngineError } from "./errors.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "./types.ts";

interface PooledSearchProviderSpec {
  readonly apiKeyPool: ApiKeyPool;
  readonly name: SearchEngineName;
  searchWithApiKey(
    apiKey: string,
    query: string,
    numResults: number
  ): Promise<SearchResult[]>;
}

interface PooledJsonProviderSpec {
  readonly apiKeyPool: ApiKeyPool;
  buildRequest(
    apiKey: string,
    query: string,
    numResults: number
  ): JsonProviderRequest;
  readonly name: SearchEngineName;
  parse(payload: unknown): ParsedResult[];
}

interface PooledCredentialPairProviderSpec {
  readonly credentialPairPool: CredentialPairPool;
  readonly name: SearchEngineName;
  searchWithCredentials(
    credentials: CredentialPair,
    query: string,
    numResults: number
  ): Promise<SearchResult[]>;
}

export function createPooledSearchProvider(
  spec: PooledSearchProviderSpec
): SearchProvider | null {
  if (!spec.apiKeyPool.hasApiKeys()) {
    return null;
  }

  return {
    name: spec.name,
    async search(query: string, numResults: number) {
      const attemptOrder = spec.apiKeyPool.getAttemptOrder();
      let lastRateLimitError: SearchEngineError | null = null;

      for (const apiKey of attemptOrder) {
        try {
          return await spec.searchWithApiKey(apiKey, query, numResults);
        } catch (error) {
          if (isKeyPoolRetryableError(error)) {
            lastRateLimitError = error;
            continue;
          }

          throw error;
        }
      }

      if (lastRateLimitError) {
        throw lastRateLimitError;
      }

      throw new SearchEngineError(
        spec.name,
        "misconfigured",
        `${spec.name} API key is not configured`
      );
    },
  };
}

export function createPooledCredentialPairSearchProvider(
  spec: PooledCredentialPairProviderSpec
): SearchProvider | null {
  if (!spec.credentialPairPool.hasCredentials()) {
    return null;
  }

  return {
    name: spec.name,
    async search(query: string, numResults: number) {
      const attemptOrder = spec.credentialPairPool.getAttemptOrder();
      let lastRateLimitError: SearchEngineError | null = null;

      for (const credentials of attemptOrder) {
        try {
          return await spec.searchWithCredentials(
            credentials,
            query,
            numResults
          );
        } catch (error) {
          if (isKeyPoolRetryableError(error)) {
            lastRateLimitError = error;
            continue;
          }

          throw error;
        }
      }

      if (lastRateLimitError) {
        throw lastRateLimitError;
      }

      throw new SearchEngineError(
        spec.name,
        "misconfigured",
        `${spec.name} credentials are not configured`
      );
    },
  };
}

export function createPooledJsonSearchProvider(
  spec: PooledJsonProviderSpec
): SearchProvider | null {
  return createPooledSearchProvider({
    apiKeyPool: spec.apiKeyPool,
    name: spec.name,
    searchWithApiKey(apiKey, query, numResults) {
      return createJsonSearchProvider({
        buildRequest: (requestQuery, requestNumResults) =>
          spec.buildRequest(apiKey, requestQuery, requestNumResults),
        name: spec.name,
        parse: spec.parse,
      }).search(query, numResults);
    },
  });
}

export function compactProviders(
  providers: readonly (SearchProvider | null)[]
): SearchProvider[] {
  return providers.filter(
    (provider): provider is SearchProvider => provider !== null
  );
}

function isKeyPoolRetryableError(error: unknown): error is SearchEngineError {
  return error instanceof SearchEngineError && error.status === 429;
}

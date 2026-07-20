import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";

export interface ApiKeyPool {
  getAttemptOrder: () => readonly string[];
  hasApiKeys: () => boolean;
}

const apiKeyPools = new WeakMap<EnvironmentReader, Map<string, ApiKeyPool>>();

export function parseApiKeyPool(source: string | undefined): readonly string[] {
  return (source ?? "")
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function readApiKeyPool(
  envName: string,
  env: EnvironmentReader = processEnvironmentReader
): readonly string[] {
  return parseApiKeyPool(env.read(envName));
}

export function createApiKeyPool(
  envName: string,
  env: EnvironmentReader = processEnvironmentReader
): ApiKeyPool {
  let apiKeyIndex = 0;
  let apiKeyPoolSource: string | undefined;
  let processEnvReference = globalThis.process?.env;

  return {
    getAttemptOrder() {
      const apiKeys = readPool();
      if (apiKeys.length === 0) {
        return [];
      }

      const startIndex = apiKeyIndex % apiKeys.length;
      apiKeyIndex = (startIndex + 1) % apiKeys.length;

      return [...apiKeys.slice(startIndex), ...apiKeys.slice(0, startIndex)];
    },
    hasApiKeys() {
      return readPool().length > 0;
    },
  };

  function readPool(): readonly string[] {
    if (
      env === processEnvironmentReader &&
      globalThis.process?.env !== processEnvReference
    ) {
      apiKeyIndex = 0;
      apiKeyPoolSource = undefined;
      processEnvReference = globalThis.process?.env;
    }

    const source = env.read(envName);

    if (source !== apiKeyPoolSource) {
      apiKeyIndex = 0;
      apiKeyPoolSource = source;
    }

    return parseApiKeyPool(source);
  }
}

export function getApiKeyPool(
  envName: string,
  env: EnvironmentReader = processEnvironmentReader
): ApiKeyPool {
  const existingPools = apiKeyPools.get(env);
  const existingPool = existingPools?.get(envName);
  if (existingPool) {
    return existingPool;
  }

  const pool = createApiKeyPool(envName, env);
  const pools = existingPools ?? new Map<string, ApiKeyPool>();
  pools.set(envName, pool);

  if (!existingPools) {
    apiKeyPools.set(env, pools);
  }

  return pool;
}

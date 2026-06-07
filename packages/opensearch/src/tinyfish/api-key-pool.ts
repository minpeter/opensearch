import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";

const TINYFISH_API_KEY_ENV = "TINYFISH_API_KEY";

export interface TinyFishApiKeyPool {
  getAttemptOrder(): readonly string[];
  hasApiKeys(): boolean;
}

const defaultTinyFishApiKeyPool = createTinyFishApiKeyPool(
  processEnvironmentReader
);

export function hasTinyFishApiKeys(): boolean {
  return defaultTinyFishApiKeyPool.hasApiKeys();
}

export function getTinyFishApiKeyAttemptOrder(): readonly string[] {
  return defaultTinyFishApiKeyPool.getAttemptOrder();
}

export function createTinyFishApiKeyPool(
  env: EnvironmentReader = processEnvironmentReader
): TinyFishApiKeyPool {
  let apiKeyIndex = 0;
  let apiKeyPoolSource: string | undefined;

  return {
    getAttemptOrder() {
      const apiKeys = readTinyFishApiKeyPool();
      if (apiKeys.length === 0) {
        return [];
      }

      const startIndex = apiKeyIndex % apiKeys.length;
      apiKeyIndex = (startIndex + 1) % apiKeys.length;

      return [...apiKeys.slice(startIndex), ...apiKeys.slice(0, startIndex)];
    },
    hasApiKeys() {
      return readTinyFishApiKeyPool().length > 0;
    },
  };

  function readTinyFishApiKeyPool(): readonly string[] {
    const source = env.read(TINYFISH_API_KEY_ENV);

    if (source !== apiKeyPoolSource) {
      apiKeyIndex = 0;
      apiKeyPoolSource = source;
    }

    return parseTinyFishApiKeyPool(source);
  }
}

function parseTinyFishApiKeyPool(
  source: string | undefined
): readonly string[] {
  return (source ?? "")
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

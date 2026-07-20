import {
  type ApiKeyPool,
  getApiKeyPool,
} from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";

const TINYFISH_API_KEY_ENV = "TINYFISH_API_KEY";

export type TinyFishApiKeyPool = ApiKeyPool;

const defaultTinyFishApiKeyPool = createTinyFishApiKeyPool(
  processEnvironmentReader
);

export function getTinyFishApiKeyAttemptOrder(): readonly string[] {
  return defaultTinyFishApiKeyPool.getAttemptOrder();
}

export function createTinyFishApiKeyPool(
  env: EnvironmentReader = processEnvironmentReader
): TinyFishApiKeyPool {
  return getApiKeyPool(TINYFISH_API_KEY_ENV, env);
}

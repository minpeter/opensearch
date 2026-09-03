import type { EnvironmentReader } from "../environment.ts";
import { processEnvironmentReader } from "../environment.ts";
import {
  type ExaMcpFetchResult,
  fetchExaMcp,
  fetchExaMcpBatch,
} from "../providers/exa-mcp/client.ts";
import { OPENSEARCH_ENABLE_EXA_MCP_ENV } from "./config.ts";
import type { ExaMcpFetchProvider } from "./provider-context.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(OPENSEARCH_ENABLE_EXA_MCP_ENV) !== "false";
}

export function fetchExaMcpBatchForEnv(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader,
  signal?: AbortSignal
): ReturnType<typeof fetchExaMcpBatch> {
  if (signal) {
    return fetchExaMcpBatch(urls, maxCharacters, env, signal);
  }
  return env === processEnvironmentReader
    ? fetchExaMcpBatch(urls, maxCharacters)
    : fetchExaMcpBatch(urls, maxCharacters, env);
}

export async function tryFetchUrlViaExaMcp(
  url: string,
  env: EnvironmentReader,
  signal?: AbortSignal
): Promise<FetchResult | null> {
  if (!isExaMcpEnabled(env)) {
    return null;
  }

  try {
    let result: ExaMcpFetchResult;
    if (signal) {
      result = await fetchExaMcp(url, env, signal);
    } else if (env === processEnvironmentReader) {
      result = await fetchExaMcp(url);
    } else {
      result = await fetchExaMcp(url, env);
    }
    return createFetchResult(url, result.content, result.title);
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

export const exaMcpFetchProvider: ExaMcpFetchProvider = {
  fetchBatch: fetchExaMcpBatchForEnv,
  fetchUrl: tryFetchUrlViaExaMcp,
  isEnabled: isExaMcpEnabled,
};

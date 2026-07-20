import type { EnvironmentReader } from "../environment.ts";
import { processEnvironmentReader } from "../environment.ts";
import { fetchExaMcp, fetchExaMcpBatch } from "../providers/exa-mcp/client.ts";
import { OPENSEARCH_ENABLE_EXA_MCP_ENV } from "./config.ts";
import type { ExaMcpFetchProvider } from "./provider-context.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(OPENSEARCH_ENABLE_EXA_MCP_ENV) !== "false";
}

export function fetchExaMcpBatchForEnv(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader
): ReturnType<typeof fetchExaMcpBatch> {
  return env === processEnvironmentReader
    ? fetchExaMcpBatch(urls, maxCharacters)
    : fetchExaMcpBatch(urls, maxCharacters, env);
}

export async function tryFetchUrlViaExaMcp(
  url: string,
  env: EnvironmentReader
): Promise<FetchResult | null> {
  if (!isExaMcpEnabled(env)) {
    return null;
  }

  try {
    const result =
      env === processEnvironmentReader
        ? await fetchExaMcp(url)
        : await fetchExaMcp(url, env);
    return createFetchResult(url, result.content, result.title);
  } catch (error) {
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

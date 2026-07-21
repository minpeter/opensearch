import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { compactProviders } from "./api-key-provider.ts";
import {
  createBraveSearchProvider,
  createTinyFishSearchProvider,
} from "./providers/core.ts";
import { createExaSearchProvider } from "./providers/exa.ts";
import { createFirecrawlSearchProvider } from "./providers/firecrawl.ts";
import { createIndependentProviders } from "./providers/independent.ts";
import { createLlmNativeProviders } from "./providers/llm.ts";
import { createOllamaSearchProvider } from "./providers/ollama.ts";
import { createSerpProviders } from "./providers/serp.ts";
import type { SearchProvider } from "./types.ts";

const EXA_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const PARALLEL_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_PARALLEL_MCP";

export interface GetSearchProvidersOptions {
  /**
   * Factory for the DuckDuckGo provider. It relies on `node:vm` to solve the
   * proof-of-work challenge and cannot run on Cloudflare Workers, so the edge
   * entry omits it; @minpeter/opensearch/node injects it here as the final
   * keyless fallback in the chain.
   */
  readonly duckDuckGoFactory?: (env: EnvironmentReader) => SearchProvider;
  readonly exaMcpFactory?: (env: EnvironmentReader) => SearchProvider;
  readonly parallelMcpFactory?: (env: EnvironmentReader) => SearchProvider;
  readonly useOllamaLocal?: boolean;
}

export function getSearchProviders(
  env: EnvironmentReader = processEnvironmentReader,
  options: GetSearchProvidersOptions = {}
): SearchProvider[] {
  return compactProviders([
    createOllamaSearchProvider(env, {
      localEnabled: options.useOllamaLocal ?? false,
    }),
    createTinyFishSearchProvider(env),
    ...createLlmNativeProviders(env),
    ...createSerpProviders(env),
    createBraveSearchProvider(env),
    ...(options.parallelMcpFactory &&
    env.read(PARALLEL_MCP_OPT_OUT_ENV) !== "false"
      ? [options.parallelMcpFactory(env)]
      : []),
    ...(options.exaMcpFactory && env.read(EXA_MCP_OPT_OUT_ENV) !== "false"
      ? [options.exaMcpFactory(env)]
      : []),
    createExaSearchProvider(env),
    ...createIndependentProviders(env),
    createFirecrawlSearchProvider(env),
    ...(options.duckDuckGoFactory ? [options.duckDuckGoFactory(env)] : []),
  ]);
}

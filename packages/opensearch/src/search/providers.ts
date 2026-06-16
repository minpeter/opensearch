import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createBraveSearchProvider,
  createTinyFishSearchProvider,
} from "./providers/core.ts";
import {
  createExaMcpSearchProvider,
  createExaSearchProvider,
} from "./providers/exa.ts";
import { createFirecrawlSearchProvider } from "./providers/firecrawl.ts";
import { createIndependentProviders } from "./providers/independent.ts";
import { createLlmNativeProviders } from "./providers/llm.ts";
import { createParallelMcpSearchProvider } from "./providers/parallel-mcp.ts";
import { createSerpProviders } from "./providers/serp.ts";
import type { SearchProvider } from "./types.ts";

const EXA_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const PARALLEL_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_PARALLEL_MCP";

function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(EXA_MCP_OPT_OUT_ENV) !== "false";
}

function isParallelMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(PARALLEL_MCP_OPT_OUT_ENV) !== "false";
}

export interface GetSearchProvidersOptions {
  /**
   * Factory for the DuckDuckGo provider. It relies on `node:vm` to solve the
   * proof-of-work challenge and cannot run on Cloudflare Workers, so the edge
   * entry omits it; @minpeter/opensearch/node injects it here as the final
   * keyless fallback in the chain.
   */
  readonly duckDuckGoFactory?: (env: EnvironmentReader) => SearchProvider;
}

export function getSearchProviders(
  env: EnvironmentReader = processEnvironmentReader,
  options: GetSearchProvidersOptions = {}
): SearchProvider[] {
  const providers: SearchProvider[] = [];

  pushProvider(providers, createTinyFishSearchProvider(env));
  providers.push(...createLlmNativeProviders(env));
  providers.push(...createSerpProviders(env));

  pushProvider(providers, createBraveSearchProvider(env));

  if (isParallelMcpEnabled(env)) {
    providers.push(createParallelMcpSearchProvider(env));
  }

  if (isExaMcpEnabled(env)) {
    providers.push(createExaMcpSearchProvider(env));
  }

  pushProvider(providers, createExaSearchProvider(env));
  providers.push(...createIndependentProviders(env));
  pushProvider(providers, createFirecrawlSearchProvider(env));

  if (options.duckDuckGoFactory) {
    providers.push(options.duckDuckGoFactory(env));
  }

  return providers;
}

function pushProvider(
  providers: SearchProvider[],
  provider: SearchProvider | null
): void {
  if (provider) {
    providers.push(provider);
  }
}

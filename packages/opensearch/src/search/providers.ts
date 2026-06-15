import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { createDuckDuckGoProvider } from "./duckduckgo.ts";
import { createAugmentedBingProvider } from "./providers/augmented-bing.ts";
import {
  createBraveSearchProvider,
  createTinyFishSearchProvider,
} from "./providers/core.ts";
import {
  createExaMcpSearchProvider,
  createExaSearchProvider,
} from "./providers/exa.ts";
import { createIndependentProviders } from "./providers/independent.ts";
import { createLlmNativeProviders } from "./providers/llm.ts";
import { createParallelMcpSearchProvider } from "./providers/parallel-mcp.ts";
import { createSerpProviders } from "./providers/serp.ts";
import { createZeroKeyProviders } from "./providers/zero-key.ts";
import { createScrapeSearchProvider, SCRAPE_SEARCH_ENGINES } from "./scrape.ts";
import type { SearchProvider } from "./types.ts";

const EXA_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const PARALLEL_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_PARALLEL_MCP";
const ZERO_KEY_OPT_OUT_ENV = "OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS";

function isExaMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(EXA_MCP_OPT_OUT_ENV) !== "false";
}

function isParallelMcpEnabled(env: EnvironmentReader): boolean {
  return env.read(PARALLEL_MCP_OPT_OUT_ENV) !== "false";
}

function isZeroKeyProvidersEnabled(env: EnvironmentReader): boolean {
  return env.read(ZERO_KEY_OPT_OUT_ENV) !== "false";
}

export function getSearchProviders(
  env: EnvironmentReader = processEnvironmentReader
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

  if (isZeroKeyProvidersEnabled(env)) {
    providers.push(...createZeroKeyProviders(env));
  }

  providers.push(createDuckDuckGoProvider(env));
  providers.push(
    isZeroKeyProvidersEnabled(env)
      ? createAugmentedBingProvider(env)
      : createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.Bing)
  );

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

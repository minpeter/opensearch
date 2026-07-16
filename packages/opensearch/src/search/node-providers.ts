import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { createDuckDuckGoProvider } from "./duckduckgo.ts";
import { createExaMcpSearchProvider } from "./providers/exa-mcp.ts";
import { createParallelMcpSearchProvider } from "./providers/parallel-mcp.ts";
import { getSearchProviders } from "./providers.ts";
import type { SearchProvider } from "./types.ts";

/** Complete Node catalog, including providers intentionally absent at the edge. */
export function getNodeSearchProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return getSearchProviders(env, {
    duckDuckGoFactory: createDuckDuckGoProvider,
    exaMcpFactory: createExaMcpSearchProvider,
    parallelMcpFactory: createParallelMcpSearchProvider,
    useOllamaLocal: true,
  });
}

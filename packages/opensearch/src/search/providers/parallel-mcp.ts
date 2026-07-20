import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { searchParallelMcp } from "../../providers/parallel-mcp/client.ts";
import { getErrorMessage, SearchEngineError } from "../errors.ts";
import { attachEngine } from "../text.ts";
import type { EngineFailureKind, SearchProvider } from "../types.ts";

export function createParallelMcpSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider {
  return {
    name: "Parallel",
    async search(query: string, numResults: number) {
      try {
        const results =
          env === processEnvironmentReader
            ? await searchParallelMcp(query)
            : await searchParallelMcp(query, env);
        if (results.length === 0) {
          throw new SearchEngineError("Parallel", "no-results", "No Results");
        }

        return attachEngine("Parallel", results).slice(0, numResults);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          throw error;
        }

        // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
        throw new SearchEngineError(
          "Parallel",
          classifyParallelMcpFailure(error),
          `Parallel MCP search failed: ${getErrorMessage(error)}`,
          { cause: error }
        );
      }
    },
  };
}

function classifyParallelMcpFailure(error: unknown): EngineFailureKind {
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("invalid api key") ||
    message.includes("payment required") ||
    message.includes("unauthorized")
  ) {
    return "misconfigured";
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return "blocked";
  }

  return "transient";
}

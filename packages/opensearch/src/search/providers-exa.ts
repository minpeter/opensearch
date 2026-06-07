import { z } from "zod";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { searchExaMcp } from "../exa-mcp.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { getErrorMessage, SearchEngineError } from "./errors.ts";
import {
  fetchSearchText,
  parseJsonResponse,
  REQUEST_TIMEOUT_MS,
} from "./http.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type {
  EngineFailureKind,
  ParsedResult,
  SearchProvider,
} from "./types.ts";

const EXA_HIGHLIGHT_MAX_CHARACTERS = 280;

const exaResponseSchema = z.object({
  results: z.array(
    z.object({
      highlights: z.array(z.string()).optional(),
      snippet: z.string().optional(),
      text: z.string().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    })
  ),
});

export function createExaMcpSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider {
  return {
    name: "Exa",
    async search(query: string, numResults: number) {
      try {
        const results =
          env === processEnvironmentReader
            ? await searchExaMcp(query, numResults)
            : await searchExaMcp(query, numResults, env);
        if (results.length === 0) {
          throw new SearchEngineError("Exa", "no-results", "No Results");
        }
        return attachEngine("Exa", results);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          throw error;
        }
        throw new SearchEngineError(
          "Exa",
          classifyExaMcpFailure(error),
          `Exa MCP search failed: ${getErrorMessage(error)}`
        );
      }
    },
  };
}

export function createExaSearchProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider | null {
  const apiKey = env.read("EXA_API_KEY")?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    name: "Exa",
    async search(query: string, numResults: number) {
      const response = await fetchSearchText({
        authFailureStatuses: new Set([401, 402]),
        engine: "Exa",
        init: {
          body: JSON.stringify({
            contents: {
              highlights: { maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS },
            },
            numResults,
            query,
            type: "auto",
          }),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getRandomUserAgent(),
            "x-api-key": apiKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: "https://api.exa.ai/search",
      });

      return attachEngine("Exa", parseExaResults(response));
    },
  };
}

function parseExaResults(responseBody: string): ParsedResult[] {
  const parsed = exaResponseSchema.safeParse(
    parseJsonResponse(responseBody, "Exa")
  );
  if (!parsed.success) {
    throw new SearchEngineError(
      "Exa",
      "transient",
      "Exa returned an unexpected response shape"
    );
  }

  const results = parsed.data.results
    .map((item) =>
      normalizeResult({
        snippet: item.highlights?.[0] ?? item.text ?? item.snippet ?? "",
        title: item.title ?? "",
        url: item.url ?? "",
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError("Exa", "no-results", "No Results");
  }

  return dedupeResults(results);
}

function classifyExaMcpFailure(error: unknown): EngineFailureKind {
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("payment required") ||
    message.includes("invalid api key") ||
    message.includes("unauthorized")
  ) {
    return "misconfigured";
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return "blocked";
  }

  return "transient";
}

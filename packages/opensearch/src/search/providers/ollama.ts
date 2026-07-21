import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  type OllamaSearchItem,
  ollamaCloudSearch,
  ollamaLocalSearch,
} from "../../providers/ollama/client.ts";
import {
  isOllamaEnabled,
  isOllamaHttpError,
  isOllamaLocalEnabled,
  readOllamaApiKey,
} from "../../providers/ollama/config.ts";
import { SearchEngineError } from "../errors.ts";
import { attachEngine, dedupeResults, normalizeResult } from "../text.ts";
import type {
  EngineFailureKind,
  ParsedResult,
  SearchProvider,
  SearchResult,
} from "../types.ts";

const ENGINE = "Ollama" as const;
const SHARED_AUTH_FAILURE_STATUSES = new Set([401, 402]);

export interface OllamaSearchProviderOptions {
  /** Whether this runtime may probe the configured local Ollama daemon. */
  readonly localEnabled?: boolean;
}

/**
 * Ollama search provider.
 *
 * Strategy: try the local daemon first (keyless), then fall back to the cloud
 * API when a key is configured. Both paths hit the same Ollama account quota,
 * so a quota (429) or genuine "no results" verdict from the local daemon is
 * propagated immediately rather than retried against the cloud.
 *
 * The provider is opt-in (`OPENSEARCH_ENABLE_OLLAMA=true`); the factory returns
 * null otherwise. The local probe is cheap (instant ECONNREFUSED when no daemon
 * runs), so once enabled it self-detects availability at search time.
 */
export function createOllamaSearchProvider(
  env: EnvironmentReader = processEnvironmentReader,
  options: OllamaSearchProviderOptions = {}
): SearchProvider | null {
  if (!isOllamaEnabled(env)) {
    return null;
  }

  return {
    name: ENGINE,
    async search(query, numResults) {
      if ((options.localEnabled ?? true) && isOllamaLocalEnabled(env)) {
        try {
          const items = await ollamaLocalSearch(query, numResults, env);
          return finalizeResults(items, numResults);
        } catch (error) {
          handleLocalSearchError(error);
          // Reaching here means the local daemon is unusable for a retryable
          // reason (unreachable, or unsigned-in) — fall through to the cloud.
        }
      }

      const apiKey = readOllamaApiKey(env);
      if (!apiKey) {
        throw new SearchEngineError(
          ENGINE,
          "misconfigured",
          "Ollama local daemon is unavailable and OLLAMA_API_KEY is not set. Start `ollama serve` (and run `ollama signin`), or provide OLLAMA_API_KEY."
        );
      }

      try {
        const items = await ollamaCloudSearch(query, numResults, apiKey);
        return finalizeResults(items, numResults);
      } catch (error) {
        throw classifyCloudSearchError(error);
      }
    },
  };
}

function finalizeResults(
  items: readonly OllamaSearchItem[],
  numResults: number
): SearchResult[] {
  const results = items
    .map((item) =>
      normalizeResult({
        snippet: item.content,
        title: item.title,
        url: item.url,
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError(ENGINE, "no-results", "No Results");
  }

  return attachEngine(ENGINE, dedupeResults(results)).slice(0, numResults);
}

/**
 * Inspect a local-daemon failure. Throws for terminal verdicts (the cloud path
 * must not be retried) and returns silently when the local daemon is merely
 * unusable and the cloud fallback should take over.
 */
function handleLocalSearchError(error: unknown): void {
  // A SearchEngineError is a deliberate verdict (e.g. no-results from
  // finalizeResults), not a transport failure — propagate it unchanged.
  if (error instanceof SearchEngineError) {
    throw error;
  }

  if (isOllamaHttpError(error)) {
    // Local and cloud share one quota: a quota exhaustion or a genuine
    // non-auth HTTP failure from the daemon reflects the shared backend and
    // must not be retried against the cloud.
    if (
      error.status === 429 ||
      !SHARED_AUTH_FAILURE_STATUSES.has(error.status)
    ) {
      throw new SearchEngineError(
        ENGINE,
        classifyOllamaStatus(error.status),
        error.message,
        { status: error.status }
      );
    }

    // 401/402: the daemon is running but the account is not signed in. The
    // cloud path authenticates independently, so let the caller fall through.
    return;
  }

  if (!isConnectionError(error)) {
    // Unexpected (e.g. malformed payload) — surface rather than masking.
    throw new SearchEngineError(
      ENGINE,
      "transient",
      `Ollama local search failed: ${errorMessage(error)}`
    );
  }

  // Daemon unreachable (refused / timed out / DNS) — try the cloud path.
}

function classifyCloudSearchError(error: unknown): SearchEngineError {
  if (error instanceof SearchEngineError) {
    return error;
  }

  if (isOllamaHttpError(error)) {
    return new SearchEngineError(
      ENGINE,
      classifyOllamaStatus(error.status),
      error.message,
      { status: error.status }
    );
  }

  return new SearchEngineError(
    ENGINE,
    "transient",
    `Ollama cloud search failed: ${errorMessage(error)}`
  );
}

function classifyOllamaStatus(status: number): EngineFailureKind {
  if (SHARED_AUTH_FAILURE_STATUSES.has(status)) {
    return "misconfigured";
  }

  if (status === 403 || status === 429 || status === 451) {
    return "blocked";
  }

  return "transient";
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // AbortSignal.timeout / cancellation surface as DOMException names.
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("fetch failed") ||
    message.includes("connect econn")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

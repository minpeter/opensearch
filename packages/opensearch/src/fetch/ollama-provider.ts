import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import type { OpenSearchFailureKind } from "../observability.ts";
import {
  ollamaCloudFetch,
  ollamaLocalFetch,
} from "../providers/ollama/client.ts";
import {
  isOllamaEnabled,
  isOllamaHttpError,
  isOllamaLocalEnabled,
  readOllamaApiKey,
} from "../providers/ollama/config.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

const SHARED_AUTH_FAILURE_STATUSES = new Set([401, 402]);

export class OllamaFetchError extends Error {
  readonly kind: OpenSearchFailureKind;
  readonly status?: number;

  constructor(
    kind: OpenSearchFailureKind,
    message: string,
    options: { readonly status?: number } = {}
  ) {
    super(message);
    this.kind = kind;
    this.name = "OllamaFetchError";
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export interface OllamaFetchProviderOptions {
  /** Whether this runtime may probe the configured local Ollama daemon. */
  readonly localEnabled?: boolean;
}

/**
 * Best-effort page fetch via Ollama's web_fetch (local daemon first, then cloud
 * API key). Mirrors the search provider's shared-quota semantics: a local quota
 * (429) or backend (non-auth) HTTP failure is not retried against the cloud,
 * since both paths hit the same account backend.
 *
 * Returns null whenever Ollama cannot serve the URL so the fetch chain can move
 * on to the next provider.
 */
export async function tryFetchUrlViaOllama(
  url: string,
  maxCharacters: number = DEFAULT_MAX_CHARACTERS,
  env: EnvironmentReader = processEnvironmentReader,
  options: OllamaFetchProviderOptions = {}
): Promise<FetchResult | null> {
  if (!isOllamaEnabled(env)) {
    return null;
  }

  if ((options.localEnabled ?? true) && isOllamaLocalEnabled(env)) {
    try {
      const result = await ollamaLocalFetch(url, env);
      if (result.content.trim().length > 0) {
        return createFetchResult(
          url,
          result.content.slice(0, maxCharacters),
          result.title
        );
      }
      // Empty content: fall through to the cloud path if configured.
    } catch (error) {
      if (!shouldFallThroughToCloud(error)) {
        throw toFetchError(error, "local");
      }
    }
  }

  const apiKey = readOllamaApiKey(env);
  if (!apiKey) {
    return null;
  }

  try {
    const result = await ollamaCloudFetch(url, apiKey);
    if (result.content.trim().length === 0) {
      return null;
    }
    return createFetchResult(
      url,
      result.content.slice(0, maxCharacters),
      result.title
    );
  } catch (error) {
    throw toFetchError(error, "cloud");
  }
}

function toFetchError(
  error: unknown,
  path: "cloud" | "local"
): OllamaFetchError {
  if (error instanceof OllamaFetchError) {
    return error;
  }
  if (isOllamaHttpError(error)) {
    return new OllamaFetchError(
      classifyOllamaStatus(error.status),
      error.message,
      { status: error.status }
    );
  }
  return new OllamaFetchError(
    "transient",
    `Ollama ${path} fetch failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

function classifyOllamaStatus(status: number): OpenSearchFailureKind {
  if (SHARED_AUTH_FAILURE_STATUSES.has(status)) {
    return "misconfigured";
  }
  if (status === 403 || status === 429 || status === 451) {
    return "blocked";
  }
  return "transient";
}

/**
 * Decide whether a local-daemon fetch failure should fall through to the cloud
 * path. Only connection failures (daemon absent) and auth failures (account not
 * signed in) qualify — a quota exhaustion or other backend error reflects the
 * shared backend and must not be retried against the cloud.
 */
function shouldFallThroughToCloud(error: unknown): boolean {
  if (isOllamaHttpError(error)) {
    return SHARED_AUTH_FAILURE_STATUSES.has(error.status);
  }

  if (error instanceof Error) {
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

  return false;
}

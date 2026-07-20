import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";

export const OLLAMA_API_KEY_ENV = "OLLAMA_API_KEY";
export const OLLAMA_HOST_ENV = "OLLAMA_HOST";
export const OPENSEARCH_ENABLE_OLLAMA_ENV = "OPENSEARCH_ENABLE_OLLAMA";
export const OPENSEARCH_DISABLE_OLLAMA_LOCAL_ENV =
  "OPENSEARCH_DISABLE_OLLAMA_LOCAL";

const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434";

const HAS_SCHEME_REGEX = /^https?:\/\//i;
const ANY_SCHEME_REGEX = /^[a-z][a-z\d+.-]*:\/\//iu;

/**
 * Thrown for non-2xx HTTP responses. Network/connection failures (no daemon,
 * DNS, refused) propagate as plain `Error` so callers can distinguish "daemon
 * unreachable, try another path" from "the server rejected the request".
 */
export class OllamaHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds: number | null
  ) {
    super(message);
    this.name = "OllamaHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isOllamaHttpError(error: unknown): error is OllamaHttpError {
  return error instanceof OllamaHttpError;
}

export function isOllamaEnabled(
  env: EnvironmentReader = processEnvironmentReader
): boolean {
  // Opt-in: enabling Ollama makes the search/fetch chain probe the local daemon
  // (and the cloud API when a key is set) on every request, which consumes the
  // signed-in account's shared quota. Default off keeps existing deployments'
  // behavior unchanged; set OPENSEARCH_ENABLE_OLLAMA=true to activate.
  return env.read(OPENSEARCH_ENABLE_OLLAMA_ENV) === "true";
}

export function isOllamaLocalEnabled(
  env: EnvironmentReader = processEnvironmentReader
): boolean {
  return env.read(OPENSEARCH_DISABLE_OLLAMA_LOCAL_ENV) !== "true";
}

export function readOllamaApiKey(
  env: EnvironmentReader = processEnvironmentReader
): string | null {
  const key = env.read(OLLAMA_API_KEY_ENV)?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Resolve the local daemon base URL from `OLLAMA_HOST`. Ollama accepts either a
 * bare `host:port` (e.g. `127.0.0.1:11434`) or a full URL; normalize both to an
 * absolute, path-stripped origin.
 */
export function resolveLocalBaseUrl(
  env: EnvironmentReader = processEnvironmentReader
): string {
  const raw = env.read(OLLAMA_HOST_ENV)?.trim();

  if (!raw) {
    return DEFAULT_LOCAL_BASE_URL;
  }

  const withScheme = HAS_SCHEME_REGEX.test(raw) ? raw : `http://${raw}`;
  if (ANY_SCHEME_REGEX.test(raw) && !HAS_SCHEME_REGEX.test(raw)) {
    return DEFAULT_LOCAL_BASE_URL;
  }
  try {
    const url = new URL(withScheme);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return DEFAULT_LOCAL_BASE_URL;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_LOCAL_BASE_URL;
  }
}

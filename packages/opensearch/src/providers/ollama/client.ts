import { z } from "zod";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { DEFAULT_MAX_DOWNLOAD_BYTES } from "../../fetch/local-options.ts";
import { readResponseText } from "../../response-body.ts";

/**
 * Ollama web search + fetch client.
 *
 * Ollama exposes the same web tools through two entry points that share one
 * hourly request quota (verified against ollama/ollama source):
 *
 *  1. Local daemon:  POST http://localhost:11434/api/experimental/web_{search,fetch}
 *     Keyless on the wire — the daemon signs each request with the signed-in
 *     user's keypair (~/.ollama), so the caller needs no API key. Requires
 *     `ollama serve` + `ollama signin`.
 *
 *  2. Cloud direct:  POST https://ollama.com/api/web_{search,fetch}
 *     Requires `OLLAMA_API_KEY` (Bearer). Same account quota as the local path.
 *
 * Because the quota is shared, a 429 from either path means the account bucket
 * is exhausted — the caller should fall back to a different provider, not retry
 * the other Ollama path.
 */

export const OLLAMA_API_KEY_ENV = "OLLAMA_API_KEY";
export const OLLAMA_HOST_ENV = "OLLAMA_HOST";
export const OPENSEARCH_ENABLE_OLLAMA_ENV = "OPENSEARCH_ENABLE_OLLAMA";
export const OPENSEARCH_DISABLE_OLLAMA_LOCAL_ENV =
  "OPENSEARCH_DISABLE_OLLAMA_LOCAL";

const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434";
const CLOUD_BASE_URL = "https://ollama.com";

const HAS_SCHEME_REGEX = /^https?:\/\//i;
const ANY_SCHEME_REGEX = /^[a-z][a-z\d+.-]*:\/\//iu;

const LOCAL_PATH_SEARCH = "/api/experimental/web_search";
const LOCAL_PATH_FETCH = "/api/experimental/web_fetch";
const CLOUD_PATH_SEARCH = "/api/web_search";
const CLOUD_PATH_FETCH = "/api/web_fetch";

// Local daemon probes must fail fast so an absent daemon (instant
// ECONNREFUSED on most hosts) does not stall the provider chain.
const LOCAL_TIMEOUT_MS = 3000;
// Cloud calls follow the project-wide search budget.
const CLOUD_TIMEOUT_MS = 8000;
// The cloud API caps max_results at 10.
const MAX_RESULTS_CAP = 10;

const ollamaSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
      })
    )
    .optional(),
});

const ollamaFetchResponseSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  links: z.array(z.string()).optional(),
});

export interface OllamaSearchItem {
  readonly content: string;
  readonly title: string;
  readonly url: string;
}

export interface OllamaFetchResult {
  readonly content: string;
  readonly links: readonly string[];
  readonly title: string;
}

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

function capMaxResults(maxResults: number): number {
  return Math.max(1, Math.min(maxResults, MAX_RESULTS_CAP));
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) {
    return null;
  }

  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function ensureOk(
  response: Response,
  label: string,
  maxResponseBytes: number
): Promise<void> {
  if (response.ok) {
    return;
  }

  const retryAfter = parseRetryAfter(response);
  const body = await readResponseText(response, maxResponseBytes).catch(
    () => ""
  );
  const detail = body.trim().slice(0, 4096) || response.statusText;
  throw new OllamaHttpError(
    response.status,
    `Ollama ${label} failed (HTTP ${response.status}): ${detail}`,
    retryAfter
  );
}

async function postJson<T>(
  url: string,
  body: unknown,
  options: {
    readonly headers?: Record<string, string>;
    readonly label: string;
    readonly timeoutMs: number;
    readonly schema: z.ZodType<T>;
    readonly signal?: AbortSignal;
    readonly maxResponseBytes?: number;
  }
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const composite = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    method: "POST",
    signal: composite,
  });

  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  await ensureOk(response, options.label, maxResponseBytes);

  const text = await readResponseText(response, maxResponseBytes);
  const json: unknown = JSON.parse(text);
  return options.schema.parse(json);
}

export async function ollamaLocalSearch(
  query: string,
  maxResults: number,
  env: EnvironmentReader = processEnvironmentReader,
  signal?: AbortSignal
): Promise<OllamaSearchItem[]> {
  const payload = await postJson(
    `${resolveLocalBaseUrl(env)}${LOCAL_PATH_SEARCH}`,
    {
      query,
      max_results: capMaxResults(maxResults),
    },
    {
      label: "local search",
      schema: ollamaSearchResponseSchema,
      signal,
      timeoutMs: LOCAL_TIMEOUT_MS,
    }
  );

  return normalizeSearchItems(payload.results);
}

export async function ollamaCloudSearch(
  query: string,
  maxResults: number,
  apiKey: string,
  signal?: AbortSignal
): Promise<OllamaSearchItem[]> {
  const payload = await postJson(
    `${CLOUD_BASE_URL}${CLOUD_PATH_SEARCH}`,
    {
      query,
      max_results: capMaxResults(maxResults),
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      label: "cloud search",
      schema: ollamaSearchResponseSchema,
      signal,
      timeoutMs: CLOUD_TIMEOUT_MS,
    }
  );

  return normalizeSearchItems(payload.results);
}

export async function ollamaLocalFetch(
  url: string,
  env: EnvironmentReader = processEnvironmentReader,
  signal?: AbortSignal
): Promise<OllamaFetchResult> {
  const payload = await postJson(
    `${resolveLocalBaseUrl(env)}${LOCAL_PATH_FETCH}`,
    { url },
    {
      label: "local fetch",
      schema: ollamaFetchResponseSchema,
      signal,
      timeoutMs: LOCAL_TIMEOUT_MS,
    }
  );

  return normalizeFetchResult(payload);
}

export async function ollamaCloudFetch(
  url: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<OllamaFetchResult> {
  const payload = await postJson(
    `${CLOUD_BASE_URL}${CLOUD_PATH_FETCH}`,
    { url },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      label: "cloud fetch",
      schema: ollamaFetchResponseSchema,
      signal,
      timeoutMs: CLOUD_TIMEOUT_MS,
    }
  );

  return normalizeFetchResult(payload);
}

function normalizeSearchItems(
  items: readonly {
    readonly title?: string;
    readonly url?: string;
    readonly content?: string;
  }[] = []
): OllamaSearchItem[] {
  return items
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      content: item.content ?? "",
    }))
    .filter((item) => item.url.length > 0);
}

function normalizeFetchResult(payload: {
  readonly title?: string;
  readonly content?: string;
  readonly links?: readonly string[];
}): OllamaFetchResult {
  return {
    title: payload.title ?? "",
    content: payload.content ?? "",
    links: payload.links ?? [],
  };
}

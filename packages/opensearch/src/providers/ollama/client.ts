import { z } from "zod";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { resolveLocalBaseUrl } from "./config.ts";
import { postOllamaJson } from "./http.ts";

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

const CLOUD_BASE_URL = "https://ollama.com";

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
        content: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .optional(),
});

const ollamaFetchResponseSchema = z.object({
  content: z.string().optional(),
  links: z.array(z.string()).optional(),
  title: z.string().optional(),
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

function capMaxResults(maxResults: number): number {
  return Math.max(1, Math.min(maxResults, MAX_RESULTS_CAP));
}

export async function ollamaLocalSearch(
  query: string,
  maxResults: number,
  env: EnvironmentReader = processEnvironmentReader,
  signal?: AbortSignal
): Promise<OllamaSearchItem[]> {
  const payload = await postOllamaJson(
    `${resolveLocalBaseUrl(env)}${LOCAL_PATH_SEARCH}`,
    {
      max_results: capMaxResults(maxResults),
      query,
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
  const payload = await postOllamaJson(
    `${CLOUD_BASE_URL}${CLOUD_PATH_SEARCH}`,
    {
      max_results: capMaxResults(maxResults),
      query,
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
  const payload = await postOllamaJson(
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
  const payload = await postOllamaJson(
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
      content: item.content ?? "",
      title: item.title ?? "",
      url: item.url ?? "",
    }))
    .filter((item) => item.url.length > 0);
}

function normalizeFetchResult(payload: {
  readonly title?: string;
  readonly content?: string;
  readonly links?: readonly string[];
}): OllamaFetchResult {
  return {
    content: payload.content ?? "",
    links: payload.links ?? [],
    title: payload.title ?? "",
  };
}

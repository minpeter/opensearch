import { z } from "zod";

import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import {
  ResponseSizeLimitError,
  readResponseJson,
  readResponseText,
} from "../../response-body.ts";
import { getBaseUrl } from "../shared/base-url.ts";
import { ProviderHttpError } from "../shared/error.ts";

const FIRECRAWL_API_KEY_ENV = "FIRECRAWL_API_KEY";
const FIRECRAWL_BASE_URL_ENV = "OPENSEARCH_FIRECRAWL_URL";
const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev/v2";
const FIRECRAWL_TIMEOUT_MS = 30_000;
const FIRECRAWL_KEY_FALLBACK_STATUSES = new Set([401, 402, 403, 429]);
const FIRECRAWL_SEARCH_MARKDOWN_MAX_CHARACTERS = 1200;
const FIRECRAWL_ERROR_DETAIL_MAX_CHARACTERS = 4096;
export const OPENSEARCH_ENABLE_FIRECRAWL_ENV = "OPENSEARCH_ENABLE_FIRECRAWL";

const optionalStringSchema = z.string().nullable().optional();

const firecrawlSearchResponseSchema = z.object({
  data: z.object({
    web: z
      .array(
        z.object({
          description: optionalStringSchema,
          markdown: optionalStringSchema,
          metadata: z
            .object({
              description: optionalStringSchema,
              sourceURL: optionalStringSchema,
              title: optionalStringSchema,
              url: optionalStringSchema,
            })
            .nullable()
            .optional(),
          title: optionalStringSchema,
          url: optionalStringSchema,
        })
      )
      .default([]),
  }),
});

const firecrawlScrapeResponseSchema = z.object({
  data: z.object({
    markdown: optionalStringSchema,
    metadata: z
      .object({
        sourceURL: optionalStringSchema,
        title: optionalStringSchema,
        url: optionalStringSchema,
      })
      .nullable()
      .optional(),
  }),
});

type FirecrawlEndpoint = "scrape" | "search";

interface FirecrawlRequestOptions {
  readonly body: unknown;
  readonly endpoint: FirecrawlEndpoint;
  readonly env: EnvironmentReader;
  readonly useApiKey: boolean;
}

export interface FirecrawlSearchResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export interface FirecrawlFetchResult {
  readonly content: string;
  readonly title: string;
}

export async function searchFirecrawl(
  query: string,
  numResults: number,
  env: EnvironmentReader = processEnvironmentReader,
  options: { readonly useApiKey?: boolean } = {}
): Promise<FirecrawlSearchResult[]> {
  const payload = await requestFirecrawlJson({
    body: {
      limit: numResults,
      query,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        parsers: ["pdf"],
        removeBase64Images: true,
      },
      sources: ["web"],
    },
    endpoint: "search",
    env,
    useApiKey: options.useApiKey ?? true,
  });
  const response = firecrawlSearchResponseSchema.parse(payload);

  return response.data.web
    .map((item) => ({
      snippet: createFirecrawlSearchSnippet(item),
      title: item.title ?? item.metadata?.title ?? "",
      url: item.url ?? item.metadata?.sourceURL ?? item.metadata?.url ?? "",
    }))
    .filter((result) => result.url.length > 0);
}

export async function fetchFirecrawlUrl(
  url: string,
  maxCharacters: number,
  env: EnvironmentReader = processEnvironmentReader
): Promise<FirecrawlFetchResult> {
  const payload = await requestFirecrawlJson({
    body: {
      blockAds: true,
      formats: ["markdown"],
      onlyCleanContent: true,
      onlyMainContent: true,
      parsers: ["pdf"],
      proxy: "auto",
      removeBase64Images: true,
      timeout: FIRECRAWL_TIMEOUT_MS,
      url,
    },
    endpoint: "scrape",
    env,
    useApiKey: true,
  });
  const response = firecrawlScrapeResponseSchema.parse(payload);
  const markdown = response.data.markdown?.trim();

  if (!markdown) {
    throw new Error("Firecrawl scrape returned no markdown content");
  }

  return {
    content: markdown.slice(0, maxCharacters),
    title: response.data.metadata?.title ?? "",
  };
}

function createFirecrawlSearchSnippet(item: {
  readonly description?: string | null;
  readonly markdown?: string | null;
  readonly metadata?: { readonly description?: string | null } | null;
}): string {
  return (
    item.description ??
    item.markdown?.slice(0, FIRECRAWL_SEARCH_MARKDOWN_MAX_CHARACTERS) ??
    item.metadata?.description ??
    ""
  );
}

export function isFirecrawlEnabled(
  env: EnvironmentReader = processEnvironmentReader
): boolean {
  return env.read(OPENSEARCH_ENABLE_FIRECRAWL_ENV) !== "false";
}

async function requestFirecrawlJson(
  options: FirecrawlRequestOptions
): Promise<unknown> {
  let lastFallbackError: Error | null = null;

  for (const apiKey of getFirecrawlAttemptOrder(options)) {
    // biome-ignore lint/performance/noAwaitInLoops: API key fallback is sequential to stop after the first successful request
    const response = await fetch(createFirecrawlEndpoint(options), {
      body: JSON.stringify(options.body),
      headers: createFirecrawlHeaders(apiKey),
      method: "POST",
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });

    if (apiKey && FIRECRAWL_KEY_FALLBACK_STATUSES.has(response.status)) {
      lastFallbackError = await createFirecrawlHttpError(
        options.endpoint,
        response
      );
      continue;
    }

    if (!response.ok) {
      throw await createFirecrawlHttpError(options.endpoint, response);
    }

    return readFirecrawlJson(options.endpoint, response);
  }

  if (lastFallbackError) {
    throw lastFallbackError;
  }

  throw new Error("Firecrawl request could not be attempted");
}

function getFirecrawlAttemptOrder(
  options: FirecrawlRequestOptions
): readonly (string | null)[] {
  if (!options.useApiKey) {
    return [null];
  }

  const apiKeys = getApiKeyPool(
    FIRECRAWL_API_KEY_ENV,
    options.env
  ).getAttemptOrder();

  return apiKeys.length > 0 ? [...apiKeys, null] : [null];
}

function createFirecrawlEndpoint(options: FirecrawlRequestOptions): string {
  const baseUrl = getBaseUrl(
    FIRECRAWL_BASE_URL_ENV,
    FIRECRAWL_DEFAULT_BASE_URL,
    options.env
  );
  const url = new URL(baseUrl);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const lastSegment = pathSegments.at(-1);

  if (lastSegment === "scrape" || lastSegment === "search") {
    url.pathname = `/${[...pathSegments.slice(0, -1), options.endpoint].join(
      "/"
    )}`;
    return url.toString();
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(options.endpoint, normalizedBaseUrl).toString();
}

function createFirecrawlHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function readFirecrawlJson(
  endpoint: FirecrawlEndpoint,
  response: Response
): Promise<unknown> {
  try {
    return await readResponseJson(response);
  } catch (error) {
    throw new Error(
      `Firecrawl ${endpoint} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

async function createFirecrawlHttpError(
  endpoint: FirecrawlEndpoint,
  response: Response
): Promise<ProviderHttpError> {
  const body = await readFirecrawlErrorBody(response);
  const message =
    body.trim().slice(0, FIRECRAWL_ERROR_DETAIL_MAX_CHARACTERS) ||
    "empty response body";

  return new ProviderHttpError(
    `Firecrawl ${endpoint} request failed with HTTP ${response.status}: ${message}`,
    response.status
  );
}

async function readFirecrawlErrorBody(response: Response): Promise<string> {
  try {
    return await readResponseText(response);
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      return error.message;
    }
    return `response body could not be read: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

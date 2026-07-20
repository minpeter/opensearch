import { getApiKeyPool } from "../../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../../environment.ts";
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
const FIRECRAWL_KEY_FALLBACK_STATUSES = new Set([401, 402, 403, 429]);
const FIRECRAWL_ERROR_DETAIL_MAX_CHARACTERS = 4096;
const TRAILING_SLASHES_REGEX = /\/+$/u;
export const FIRECRAWL_TIMEOUT_MS = 30_000;

export type FirecrawlEndpoint = "scrape" | "search";

export interface FirecrawlRequestOptions {
  readonly body: unknown;
  readonly endpoint: FirecrawlEndpoint;
  readonly env: EnvironmentReader;
  readonly useApiKey: boolean;
}

export async function requestFirecrawlJson(
  options: FirecrawlRequestOptions
): Promise<unknown> {
  for (const apiKey of getFirecrawlAttemptOrder(options)) {
    // biome-ignore lint/performance/noAwaitInLoops: API key fallback is sequential to stop after the first successful request
    const response = await fetch(createFirecrawlEndpoint(options), {
      body: JSON.stringify(options.body),
      headers: createFirecrawlHeaders(apiKey),
      method: "POST",
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });

    if (apiKey && FIRECRAWL_KEY_FALLBACK_STATUSES.has(response.status)) {
      continue;
    }

    if (!response.ok) {
      throw await createFirecrawlHttpError(options.endpoint, response);
    }

    return readFirecrawlJson(options.endpoint, response);
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

  const pathPrefix = url.pathname.replace(TRAILING_SLASHES_REGEX, "");
  url.pathname = `${pathPrefix}/${options.endpoint}`;
  return url.toString();
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

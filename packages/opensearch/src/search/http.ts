import { z } from "zod";
import { awaitAbortable, throwIfAborted, withAbortSignal } from "../abort.ts";
import { cancelResponseBody, readResponseText } from "../response-body.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { SearchEngineError } from "./errors.ts";
import type { EngineFailureKind, SearchEngineName } from "./types.ts";

export const REQUEST_TIMEOUT_MS = 8000;

const AUTH_FAILURE_STATUSES = new Set([401, 402]);

export const BROWSER_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
} as const;

export function createSearchRequestInit(
  method: "GET" | "POST",
  body?: BodyInit
): RequestInit {
  return {
    body,
    headers: {
      ...BROWSER_HEADERS,
      "User-Agent": getRandomUserAgent(),
    },
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export function createSearchUrl(
  baseUrl: string,
  params: Record<string, string>
): string {
  const url = new URL(baseUrl);
  url.search = "";

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export function classifyStatusFailure(status: number): EngineFailureKind {
  if (status === 403 || status === 429 || status === 451) {
    return "blocked";
  }

  return "transient";
}

export function classifyApiStatusFailure(
  status: number,
  authFailureStatuses: ReadonlySet<number> = AUTH_FAILURE_STATUSES
): EngineFailureKind {
  if (authFailureStatuses.has(status)) {
    return "misconfigured";
  }

  return classifyStatusFailure(status);
}

export async function fetchSearchText({
  authFailureStatuses,
  engine,
  init,
  url,
  signal,
}: {
  readonly authFailureStatuses?: ReadonlySet<number>;
  readonly engine: SearchEngineName;
  readonly init: RequestInit;
  readonly url: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  try {
    return await withAbortSignal(
      signal,
      REQUEST_TIMEOUT_MS,
      async (requestSignal) => {
        const response = await fetch(url, {
          ...init,
          redirect: init.redirect ?? "manual",
          signal: requestSignal,
        });
        if (!response.ok) {
          await cancelResponseBody(response);
          throw new SearchEngineError(
            engine,
            classifyApiStatusFailure(response.status, authFailureStatuses),
            `${engine} fetch failed with status ${response.status}`,
            { status: response.status }
          );
        }
        return awaitAbortable(readResponseText(response), requestSignal);
      }
    );
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof SearchEngineError) {
      throw error;
    }
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      engine,
      "transient",
      `${engine} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export function parseJsonResponse(
  responseBody: string,
  engine: SearchEngineName
): unknown {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    return parsed;
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      engine,
      "transient",
      `${engine} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

export const unknownRecordSchema = z.record(z.string(), z.unknown());

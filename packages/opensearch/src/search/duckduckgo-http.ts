import { readResponseText } from "../response-body.ts";
import { SearchEngineError } from "./errors.ts";
import { REQUEST_TIMEOUT_MS } from "./http.ts";

export interface DuckDuckGoFetchedText {
  readonly body: string;
  readonly ok: boolean;
  readonly status: number;
}

export async function fetchDuckDuckGoText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<DuckDuckGoFetchedText> {
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      headers,
      signal: requestSignal,
    });
    const body = await readResponseText(response, undefined, requestSignal);
    if (signal?.aborted) {
      throw signal.reason;
    }
    return {
      body,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      "DuckDuckGo",
      "transient",
      `DuckDuckGo fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

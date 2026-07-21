import type { Dispatcher } from "undici";
import {
  assertSafeHttpUrl,
  NetworkPolicyError,
} from "../node/network-policy.ts";
import { readResponseBytes } from "../response-body.ts";
import { BROWSER_HEADERS } from "../search/http.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import type { AttemptExecutorInput } from "./attempt-planner.ts";
import type { ResolvedLocalFetchOptions } from "./local-options.ts";

const FETCH_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface LocalFetchContext {
  readonly dispatcher: Dispatcher;
  readonly options: ResolvedLocalFetchOptions;
}

type DispatcherRequestInit = RequestInit & {
  readonly dispatcher: Dispatcher;
};

function buildRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    "User-Agent": getRandomUserAgent(),
  };
  try {
    // A same-origin Referer makes the request look like in-site navigation,
    // which referer-gating WAFs expect.
    headers.Referer = `${new URL(url).origin}/`;
  } catch {
    // Non-absolute URL — let the fetch surface the error itself.
  }
  return headers;
}

export async function fetchPage(
  rawUrl: string,
  context: LocalFetchContext
): Promise<Response> {
  let url = assertSafeHttpUrl(rawUrl, context.options.allowPrivateNetwork);

  for (let redirectCount = 0; ; redirectCount += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each redirect URL depends on the previous response location
    const response = await fetch(url, {
      dispatcher: context.dispatcher,
      headers: buildRequestHeaders(url.toString()),
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    } as DispatcherRequestInit);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }
    if (redirectCount >= context.options.maxRedirects) {
      await response.body?.cancel();
      throw new NetworkPolicyError(
        `Fetch exceeded the ${context.options.maxRedirects}-redirect limit`
      );
    }

    await response.body?.cancel();
    url = assertSafeHttpUrl(
      new URL(location, url),
      context.options.allowPrivateNetwork
    );
  }
}

export async function fetchAttemptResponse(
  input: AttemptExecutorInput,
  context: LocalFetchContext
) {
  const response = await fetchPage(input.url, context);
  const bytes = await readResponseBytes(
    response,
    context.options.maxDownloadBytes
  );
  const body = new TextDecoder().decode(bytes);
  return {
    body,
    headers: response.headers,
    response: new Response(Uint8Array.from(bytes).buffer, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    }),
    status: response.status,
    url: response.url || input.url,
  };
}

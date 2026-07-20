import { DEFAULT_MAX_DOWNLOAD_BYTES } from "../fetch/local-options.ts";
import { assertTextByteLimit, readResponseText } from "../response-body.ts";

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface WreqModule {
  readonly fetch: (url: string, init: WreqFetchInit) => Promise<WreqResponse>;
  readonly getProfiles?: () => Promise<readonly string[]> | readonly string[];
}

export interface WreqFetchInit {
  readonly browser?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly redirect?: "error" | "follow" | "manual";
  readonly signal?: AbortSignal;
}

export interface WreqResponse {
  readonly body?: ReadableStream<Uint8Array> | null;
  readonly headers?: unknown;
  readonly status: number;
  text: () => Promise<string>;
  readonly url?: string;
}

export type WreqLoader = () => Promise<WreqModule>;

export interface WreqRedirectPolicyOptions {
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  readonly validateUrl?: (url: string) => void;
}

export function defaultWreqLoader(): Promise<WreqModule> {
  return import("wreq-js") as Promise<WreqModule>;
}

export async function fetchWreqWithRedirectPolicy(
  wreq: WreqModule,
  rawUrl: string,
  init: WreqFetchInit,
  options: WreqRedirectPolicyOptions
): Promise<WreqResponse> {
  let url = rawUrl;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  for (let redirectCount = 0; ; redirectCount += 1) {
    options.validateUrl?.(url);
    // biome-ignore lint/performance/noAwaitInLoops: each redirect URL depends on the previous response location
    const response = await wreq.fetch(url, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = toHeaders(response.headers).get("Location");
    if (!location) {
      return response;
    }
    if (redirectCount >= maxRedirects) {
      await response.body?.cancel();
      throw new Error(`TLS fetch exceeded the ${maxRedirects}-redirect limit`);
    }

    await response.body?.cancel();
    url = new URL(location, url).toString();
  }
}

export async function readWreqText(
  response: WreqResponse,
  maxResponseBytes = DEFAULT_MAX_DOWNLOAD_BYTES
): Promise<string> {
  if (response.body) {
    return readResponseText(
      { body: response.body, headers: toHeaders(response.headers) },
      maxResponseBytes
    );
  }

  const text = await response.text();
  assertTextByteLimit(text, maxResponseBytes);
  return text;
}

export function toHeaders(input: unknown): Headers {
  if (input instanceof Headers) {
    return input;
  }
  const headers = new Headers();
  if (isHeaderIterable(input)) {
    for (const [key, value] of input.entries()) {
      headers.set(key, value);
    }
  }
  return headers;
}

function isHeaderIterable(
  value: unknown
): value is { entries: () => IterableIterator<[string, string]> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    typeof value.entries === "function"
  );
}

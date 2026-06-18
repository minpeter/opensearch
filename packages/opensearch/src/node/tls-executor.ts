import { validateChallenge } from "../fetch/challenge.ts";
import type { FetchAttemptTrace, FetchVerdict } from "../fetch/result.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BROWSER_PROFILES = [
  "chrome_131",
  "chrome_142",
  "safari_17",
  "chrome",
] as const;
const OK_VERDICTS = new Set<FetchVerdict>(["strong_ok", "weak_ok"]);
const TLS_ENV = "OPENSEARCH_ENABLE_TLS_IMPERSONATION";

export interface TlsImpersonationOptions {
  readonly browserProfiles?: readonly string[];
  readonly enabled?: boolean;
  readonly loader?: WreqLoader;
  readonly referer?: string;
  readonly timeoutMs?: number;
}

export interface TlsImpersonationResult {
  readonly response?: Response;
  readonly summary?: string;
  readonly trace: readonly FetchAttemptTrace[];
  readonly verdict: FetchVerdict;
}

interface WreqModule {
  readonly fetch: (url: string, init: WreqFetchInit) => Promise<WreqResponse>;
  readonly getProfiles?: () => Promise<readonly string[]> | readonly string[];
}

interface WreqFetchInit {
  readonly browser?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

interface WreqResponse {
  readonly headers?: unknown;
  readonly status: number;
  text(): Promise<string>;
  readonly url?: string;
}

export type WreqLoader = () => Promise<WreqModule>;

export function tlsImpersonationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[TLS_ENV] === "true";
}

export async function fetchViaTlsImpersonation(
  url: string,
  options: TlsImpersonationOptions = {}
): Promise<TlsImpersonationResult> {
  if (!(options.enabled ?? tlsImpersonationEnabled())) {
    return unavailableTrace(url, "tls impersonation disabled");
  }

  const loader = options.loader ?? defaultWreqLoader;
  let wreq: WreqModule;
  try {
    wreq = await loader();
  } catch (error) {
    return unavailableTrace(url, errorMessage(error));
  }

  const profiles = await supportedProfiles(wreq, options.browserProfiles);
  const trace: FetchAttemptTrace[] = [];
  for (const profile of profiles) {
    const startedAt = Date.now();
    try {
      const response = await wreq.fetch(url, {
        browser: profile,
        headers: tlsHeaders(url, options.referer),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const body = await response.text();
      const validation = validateChallenge({
        body,
        headers: toHeaders(response.headers),
        status: response.status,
        tinyBodyIsChallenge: false,
      });
      trace.push(
        tlsTrace(url, profile, validation.verdict, {
          bodySize: validation.bodySize,
          elapsedMs: Date.now() - startedAt,
          reasons: validation.reasons,
          status: validation.status,
          summary: validation.reasons.join(", ") || undefined,
        })
      );
      if (OK_VERDICTS.has(validation.verdict)) {
        return {
          response: new Response(body, {
            headers: toHeaders(response.headers),
            status: response.status,
          }),
          trace,
          verdict: validation.verdict,
        };
      }
    } catch (error) {
      trace.push(
        tlsTrace(url, profile, "unknown", {
          elapsedMs: Date.now() - startedAt,
          summary: errorMessage(error),
        })
      );
    }
  }
  return {
    summary: "tls_impersonation_exhausted",
    trace,
    verdict: trace.at(-1)?.verdict ?? "unknown",
  };
}

function defaultWreqLoader(): Promise<WreqModule> {
  return import("wreq-js") as Promise<WreqModule>;
}

async function supportedProfiles(
  wreq: WreqModule,
  preferred: readonly string[] = DEFAULT_BROWSER_PROFILES
): Promise<readonly string[]> {
  if (!wreq.getProfiles) {
    return preferred;
  }
  const available = await wreq.getProfiles();
  const selected = preferred.filter((profile) => available.includes(profile));
  return selected.length > 0 ? selected : preferred;
}

function tlsHeaders(
  url: string,
  referer: string | undefined
): Readonly<Record<string, string>> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: referer ?? `${new URL(url).origin}/`,
  };
}

function tlsTrace(
  url: string,
  profile: string,
  verdict: FetchVerdict,
  values: Omit<FetchAttemptTrace, "executor" | "name" | "profileUsed" | "url">
): FetchAttemptTrace {
  return {
    ...values,
    executor: "wreq-js",
    name: `tls:wreq-js:${profile}`,
    profileUsed: `tls:${profile}`,
    url,
    verdict,
  };
}

function unavailableTrace(
  url: string,
  summary: string
): TlsImpersonationResult {
  return {
    summary,
    trace: [
      {
        executor: "wreq-js",
        name: "tls:wreq-js:unavailable",
        summary,
        url,
        verdict: "unknown",
      },
    ],
    verdict: "unknown",
  };
}

function toHeaders(input: unknown): Headers {
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
): value is { entries(): IterableIterator<[string, string]> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    typeof value.entries === "function"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "wreq-js unavailable";
}

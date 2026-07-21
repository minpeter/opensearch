import { validateChallenge } from "../fetch/challenge.ts";
import type { FetchAttemptTrace, FetchVerdict } from "../fetch/result.ts";
import { ResponseSizeLimitError } from "../response-body.ts";
import {
  defaultWreqLoader,
  fetchWreqWithRedirectPolicy,
  readWreqText,
  toHeaders,
  type WreqLoader,
  type WreqModule,
} from "./wreq.ts";

export type { WreqLoader } from "./wreq.ts";

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
  readonly abortOnError?: (error: unknown) => boolean;
  readonly browserProfiles?: readonly string[];
  readonly enabled?: boolean;
  readonly loader?: WreqLoader;
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  readonly referer?: string;
  readonly timeoutMs?: number;
  readonly validateUrl?: (url: string) => void;
}

export interface TlsImpersonationResult {
  readonly response?: Response;
  readonly summary?: string;
  readonly trace: readonly FetchAttemptTrace[];
  readonly verdict: FetchVerdict;
}

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
      // biome-ignore lint/performance/noAwaitInLoops: browser profiles are tried sequentially to stop after the first valid response
      const response = await fetchWreqWithRedirectPolicy(
        wreq,
        url,
        {
          browser: profile,
          headers: tlsHeaders(url, options.referer),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
        options
      );
      const body = await readWreqText(response, options.maxResponseBytes);
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
      if (
        error instanceof ResponseSizeLimitError ||
        options.abortOnError?.(error)
      ) {
        throw error;
      }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "wreq-js unavailable";
}

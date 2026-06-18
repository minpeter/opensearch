import { type ApiDiscoveryIntent, apiDiscoveryHint } from "./api-discovery.ts";
import { validateChallenge } from "./challenge.ts";
import type { FetchAttemptTrace, FetchVerdict } from "./result.ts";
import {
  transformedUrlAttempts,
  type UrlTransformName,
} from "./url-transforms.ts";

const DEFAULT_MAX_ATTEMPTS = 4;
const HOST_RETRY_TRANSFORMS = new Set<UrlTransformName>([
  "mobile_subdomain",
  "drop_www",
  "am_prefix",
]);
const OK_VERDICTS = new Set<FetchVerdict>(["strong_ok", "weak_ok"]);
const RETRY_BLOCK_STATUSES = new Set([403, 429, 430, 503]);

export interface AttemptExecutorInput {
  readonly name: string;
  readonly phase: "probe" | "grid";
  readonly url: string;
  readonly urlTransform: string;
}

export interface AttemptExecutorResult<TResponse> {
  readonly body: string;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>> | Headers;
  readonly response: TResponse;
  readonly status: number;
  readonly url?: string;
}

export interface AttemptPlanOptions<TResponse> {
  readonly executor: (
    input: AttemptExecutorInput
  ) => Promise<AttemptExecutorResult<TResponse>>;
  readonly executorName?: string;
  readonly maxAttempts?: number;
  readonly requestIntent?: ApiDiscoveryIntent;
  readonly successSelectors?: readonly string[];
}

export interface AttemptPlanResult<TResponse> {
  readonly response?: TResponse;
  readonly summary?: string;
  readonly trace: readonly FetchAttemptTrace[];
  readonly verdict: FetchVerdict;
}

export async function runAttemptPlan<TResponse>(
  url: string,
  options: AttemptPlanOptions<TResponse>
): Promise<AttemptPlanResult<TResponse>> {
  const attempts = plannedAttempts(url).slice(
    0,
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  );
  const trace: FetchAttemptTrace[] = [];

  for (const attempt of attempts) {
    const startedAt = Date.now();
    try {
      const result = await options.executor({
        ...attempt,
        name: options.executorName ?? "local-fetch",
      });
      const validation = validateChallenge({
        body: result.body,
        cookies: result.cookies,
        headers: result.headers,
        status: result.status,
        successSelectors: options.successSelectors,
        tinyBodyIsChallenge: false,
      });
      trace.push({
        bodySize: validation.bodySize,
        elapsedMs: Date.now() - startedAt,
        executor: options.executorName ?? "local-fetch",
        name: attempt.name,
        phase: attempt.phase,
        profileUsed: validation.profiles[0]?.profileId,
        reasons: validation.reasons,
        status: validation.status,
        summary: validation.reasons.join(", ") || undefined,
        url: result.url ?? attempt.url,
        urlTransform: attempt.urlTransform,
        verdict: validation.verdict,
      });
      if (OK_VERDICTS.has(validation.verdict)) {
        return {
          response: result.response,
          trace,
          verdict: validation.verdict,
        };
      }
      if (isUnretryableStatus(validation.status)) {
        return { trace, verdict: validation.verdict };
      }
    } catch (error) {
      trace.push({
        elapsedMs: Date.now() - startedAt,
        executor: options.executorName ?? "local-fetch",
        name: attempt.name,
        phase: attempt.phase,
        summary: error instanceof Error ? error.message : "attempt failed",
        url: attempt.url,
        urlTransform: attempt.urlTransform,
        verdict: "unknown",
      });
    }
  }

  return {
    summary: apiDiscoveryHint(url, trace, options.requestIntent),
    trace,
    verdict: finalVerdict(trace),
  };
}

function plannedAttempts(url: string): readonly AttemptExecutorInput[] {
  const attempts: AttemptExecutorInput[] = [
    {
      name: "probe:original",
      phase: "probe",
      url,
      urlTransform: "original",
    },
  ];
  for (const transform of transformedUrlAttempts(url)) {
    if (HOST_RETRY_TRANSFORMS.has(transform.name)) {
      attempts.push({
        name: `grid:${transform.name}`,
        phase: "grid",
        url: transform.url,
        urlTransform: transform.name,
      });
    }
  }
  return attempts;
}

function isUnretryableStatus(status: number): boolean {
  return status >= 400 && !RETRY_BLOCK_STATUSES.has(status);
}

function finalVerdict(trace: readonly FetchAttemptTrace[]): FetchVerdict {
  const lastVerdict = trace.at(-1)?.verdict;
  return lastVerdict ?? "unknown";
}

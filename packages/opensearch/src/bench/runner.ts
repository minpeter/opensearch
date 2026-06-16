import { SearchEngineError } from "../search/errors.ts";
import type { SearchProvider } from "../search/types.ts";
import type { BenchQuery, Clock, ProbeOutcome } from "./types.ts";

const TIMEOUT_MESSAGE_PATTERN = /timed?\s*out|timeout|aborted|ETIMEDOUT/i;
const DEFAULT_CONCURRENCY = 4;

const defaultClock: Clock = {
  now: () => performance.now(),
};

class BenchTimeoutError extends Error {
  constructor(engine: string, deadlineMs: number) {
    super(`${engine} exceeded bench deadline of ${deadlineMs}ms`);
    this.name = "BenchTimeoutError";
  }
}

export interface RunBenchmarkOptions {
  readonly clock?: Clock;
  /** Max providers probed at once. Queries within a provider stay sequential. */
  readonly concurrency?: number;
  /** Runner-owned deadline; when it fires the probe is recorded as timed out. */
  readonly deadlineMs?: number;
  readonly numResults: number;
  readonly providers: readonly SearchProvider[];
  readonly queries: readonly BenchQuery[];
}

function withDeadline<T>(
  promise: Promise<T>,
  engine: string,
  deadlineMs: number | undefined
): Promise<T> {
  // An invalid deadline (NaN, 0, negative) would otherwise fire setTimeout
  // immediately and record every probe as a spurious timeout. Treat it as
  // "no deadline", matching the undefined case.
  if (
    deadlineMs === undefined ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0
  ) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BenchTimeoutError(engine, deadlineMs));
    }, deadlineMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function failureOutcome(
  provider: SearchProvider,
  query: string,
  latencyMs: number,
  error: unknown
): ProbeOutcome {
  if (error instanceof BenchTimeoutError) {
    return {
      engine: provider.name,
      latencyMs,
      message: error.message,
      ok: false,
      query,
      results: [],
      timedOut: true,
    };
  }

  if (error instanceof SearchEngineError) {
    const message = error.message;
    return {
      engine: provider.name,
      errorKind: error.kind,
      latencyMs,
      message,
      ok: false,
      query,
      results: [],
      ...(error.status === undefined ? {} : { status: error.status }),
      timedOut:
        error.kind === "transient" && TIMEOUT_MESSAGE_PATTERN.test(message),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    engine: provider.name,
    errorKind: "transient",
    latencyMs,
    message,
    ok: false,
    query,
    results: [],
    timedOut: TIMEOUT_MESSAGE_PATTERN.test(message),
  };
}

async function probe(
  provider: SearchProvider,
  query: string,
  numResults: number,
  clock: Clock,
  deadlineMs: number | undefined
): Promise<ProbeOutcome> {
  const start = clock.now();
  try {
    const results = await withDeadline(
      provider.search(query, numResults),
      provider.name,
      deadlineMs
    );
    return {
      engine: provider.name,
      latencyMs: clock.now() - start,
      ok: true,
      query,
      results,
      timedOut: false,
    };
  } catch (error) {
    return failureOutcome(provider, query, clock.now() - start, error);
  }
}

async function probeProvider(
  provider: SearchProvider,
  queries: readonly BenchQuery[],
  numResults: number,
  clock: Clock,
  deadlineMs: number | undefined
): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  // Sequential within a provider to avoid self-throttling its rate limits.
  for (const query of queries) {
    outcomes.push(
      await probe(provider, query.query, numResults, clock, deadlineMs)
    );
  }
  return outcomes;
}

/**
 * Probe every provider against every query. Each probe is a single, un-cached,
 * un-retried `provider.search` call so measured latency and error rates reflect
 * one real attempt. Providers run concurrently (bounded); their queries run
 * sequentially. Probes are returned grouped by provider, in provider order.
 */
export async function runBenchmark(
  options: RunBenchmarkOptions
): Promise<ProbeOutcome[]> {
  const clock = options.clock ?? defaultClock;
  const requestedConcurrency = options.concurrency;
  const concurrency =
    requestedConcurrency !== undefined && Number.isFinite(requestedConcurrency)
      ? Math.max(1, Math.floor(requestedConcurrency))
      : DEFAULT_CONCURRENCY;
  const providers = options.providers;
  const results: ProbeOutcome[][] = new Array(providers.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < providers.length) {
      const index = cursor;
      cursor += 1;
      const provider = providers[index];
      if (provider === undefined) {
        continue;
      }
      results[index] = await probeProvider(
        provider,
        options.queries,
        options.numResults,
        clock,
        options.deadlineMs
      );
    }
  };

  const workerCount = Math.min(concurrency, providers.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.flatMap((batch) => batch ?? []);
}

import { createEnvironmentReader } from "../environment.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_MAX_CONCURRENCY,
} from "../fetch/config.ts";
import { createFetchResult } from "../fetch/result.ts";
import { createFetchService } from "../fetch.ts";

const INPUT_COUNT = 100;
const UNIQUE_DUPLICATED_URL_COUNT = 10;
const PROVIDER_DELAY_MS = 5;
const RUN_TIMEOUT_MS = 5000;
const WARMUP_COUNT = 3;
const ITERATION_COUNT = 20;

interface ProbeResult {
  readonly elapsedMs: number;
  readonly outputCount: number;
  readonly outputOrderPreserved: boolean;
  readonly peakConcurrency: number;
  readonly providerCalls: number;
}

interface Distribution {
  readonly max: number;
  readonly mean: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
}

interface WorkloadReport {
  readonly elapsedMs: Distribution;
  readonly outputCount: number;
  readonly outputOrderPreserved: boolean;
  readonly peakConcurrency: number;
  readonly providerCalls: number;
}

const env = createEnvironmentReader({
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(sortedValues: readonly number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * ratio) - 1);
  const value = sortedValues[index];

  if (value === undefined) {
    throw new Error("Cannot calculate a percentile without samples.");
  }

  return value;
}

function distribution(values: readonly number[]): Distribution {
  const sortedValues = [...values].sort((left, right) => left - right);
  const [first] = sortedValues;
  const last = sortedValues.at(-1);

  if (first === undefined || last === undefined) {
    throw new Error("Cannot summarize a benchmark without samples.");
  }

  return {
    max: round(last),
    mean: round(
      values.reduce((total, value) => total + value, 0) / values.length
    ),
    min: round(first),
    p50: round(percentile(sortedValues, 0.5)),
    p95: round(percentile(sortedValues, 0.95)),
  };
}

function invariantValue(values: readonly number[], name: string): number {
  const uniqueValues = [...new Set(values)];
  const [value] = uniqueValues;

  if (uniqueValues.length !== 1 || value === undefined) {
    throw new Error(`${name} changed between benchmark iterations.`);
  }

  return value;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Benchmark probe exceeded ${timeoutMs} ms.`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

async function runProbe(urls: readonly string[]): Promise<ProbeResult> {
  let active = 0;
  let peakConcurrency = 0;
  let providerCalls = 0;
  const service = createFetchService(env, {
    localFetch: async (url) => {
      active += 1;
      providerCalls += 1;
      peakConcurrency = Math.max(peakConcurrency, active);

      try {
        await new Promise((resolve) => setTimeout(resolve, PROVIDER_DELAY_MS));
        return createFetchResult(url, `content:${url}`);
      } finally {
        active -= 1;
      }
    },
  });
  const startedAt = performance.now();
  const results = await withTimeout(
    service.fetch(urls, { maxCharacters: DEFAULT_MAX_CHARACTERS }),
    RUN_TIMEOUT_MS
  );

  return {
    elapsedMs: performance.now() - startedAt,
    outputCount: results.length,
    outputOrderPreserved: results.every(
      (result, index) => result.url === urls[index]
    ),
    peakConcurrency,
    providerCalls,
  };
}

async function benchmarkWorkload(
  urls: readonly string[]
): Promise<WorkloadReport> {
  for (const _warmup of Array.from({ length: WARMUP_COUNT })) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential benchmark measurement
    await runProbe(urls);
  }

  const samples: ProbeResult[] = [];
  for (const _iteration of Array.from({ length: ITERATION_COUNT })) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential benchmark measurement
    samples.push(await runProbe(urls));
  }

  return {
    elapsedMs: distribution(samples.map((sample) => sample.elapsedMs)),
    outputCount: invariantValue(
      samples.map((sample) => sample.outputCount),
      "outputCount"
    ),
    outputOrderPreserved: samples.every(
      (sample) => sample.outputOrderPreserved
    ),
    peakConcurrency: invariantValue(
      samples.map((sample) => sample.peakConcurrency),
      "peakConcurrency"
    ),
    providerCalls: invariantValue(
      samples.map((sample) => sample.providerCalls),
      "providerCalls"
    ),
  };
}

const duplicatedUrls = Array.from(
  { length: INPUT_COUNT },
  (_value, index) =>
    `https://example.com/repeated-${index % UNIQUE_DUPLICATED_URL_COUNT}`
);
const uniqueUrls = Array.from(
  { length: INPUT_COUNT },
  (_value, index) => `https://example.com/unique-${index}`
);

const report = {
  duplicated: await benchmarkWorkload(duplicatedUrls),
  meta: {
    defaultMaxConcurrency: DEFAULT_MAX_CONCURRENCY,
    hypothesis:
      "Bounded scheduling caps per-URL fan-out and duplicate inputs execute once without changing output cardinality or order.",
    inputCount: INPUT_COUNT,
    iterations: ITERATION_COUNT,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    providerDelayMs: PROVIDER_DELAY_MS,
    timeoutMs: RUN_TIMEOUT_MS,
    uniqueDuplicatedUrlCount: UNIQUE_DUPLICATED_URL_COUNT,
    warmups: WARMUP_COUNT,
  },
  unique: await benchmarkWorkload(uniqueUrls),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

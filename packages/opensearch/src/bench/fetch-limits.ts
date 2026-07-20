import { createEnvironmentReader } from "../environment.ts";
import { createFetchResult } from "../fetch/result.ts";
import { createFetchService, type FetchResult } from "../fetch.ts";

const DEFAULT_MAX_CHARACTERS = 12_000;
const EXPLICIT_MAX_CHARACTERS = 1000;
const FIXTURE_CHARACTERS = 20_000;
const ITERATIONS = 50;
const WARM_UP_ITERATIONS = 5;

interface Workload {
  readonly limit: number;
  readonly name: string;
  run: () => Promise<FetchResult[]>;
}

interface WorkloadReport {
  readonly complianceRate: number;
  readonly compliantSamples: number;
  readonly limit: number;
  readonly maxObservedLength: number;
  readonly maxOverflow: number;
  readonly minObservedLength: number;
  readonly samples: number;
  readonly workload: string;
}

const fixtureContent = "x".repeat(FIXTURE_CHARACTERS);
const environment = createEnvironmentReader({
  OPENSEARCH_ENABLE_EXA_MCP: "false",
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
});
const service = createFetchService(environment, {
  localFetch: async (url) =>
    createFetchResult(url, fixtureContent, "Fixture title"),
});

const workloads: Workload[] = [
  {
    limit: EXPLICIT_MAX_CHARACTERS,
    name: "single-explicit-1000",
    run: async () => [
      await service.fetch("https://example.com/single", {
        maxCharacters: EXPLICIT_MAX_CHARACTERS,
      }),
    ],
  },
  {
    limit: EXPLICIT_MAX_CHARACTERS,
    name: "batch-explicit-1000",
    run: () =>
      service.fetch(["https://example.com/one", "https://example.com/two"], {
        maxCharacters: EXPLICIT_MAX_CHARACTERS,
      }),
  },
  {
    limit: DEFAULT_MAX_CHARACTERS,
    name: "single-default-12000",
    run: async () => [await service.fetch("https://example.com/default")],
  },
];

async function measureWorkload(workload: Workload): Promise<WorkloadReport> {
  for (let index = 0; index < WARM_UP_ITERATIONS; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential benchmark measurement
    await workload.run();
  }

  const observedLengths: number[] = [];
  let compliantSamples = 0;

  for (let index = 0; index < ITERATIONS; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential benchmark measurement
    const results = await workload.run();
    for (const result of results) {
      const contentLength = result.content.length;
      observedLengths.push(contentLength);
      if (contentLength <= workload.limit && result.length === contentLength) {
        compliantSamples += 1;
      }
    }
  }

  const maxObservedLength = Math.max(...observedLengths);
  return {
    complianceRate: compliantSamples / observedLengths.length,
    compliantSamples,
    limit: workload.limit,
    maxObservedLength,
    maxOverflow: Math.max(0, maxObservedLength - workload.limit),
    minObservedLength: Math.min(...observedLengths),
    samples: observedLengths.length,
    workload: workload.name,
  };
}

const report: WorkloadReport[] = [];
for (const workload of workloads) {
  // biome-ignore lint/performance/noAwaitInLoops: sequential benchmark measurement
  report.push(await measureWorkload(workload));
}

process.stdout.write(
  `${JSON.stringify(
    {
      conditions: {
        fixtureCharacters: FIXTURE_CHARACTERS,
        iterations: ITERATIONS,
        network: false,
        node: process.version,
        timeoutMs: null,
        warmUpIterations: WARM_UP_ITERATIONS,
      },
      hypothesis:
        "Core fetch enforces the effective content limit after every provider and fallback.",
      limitations: [
        "Uses a deterministic in-process provider that deliberately ignores the requested limit.",
        "Measures the returned-result contract, not network response bytes or extractor memory use.",
      ],
      report,
    },
    null,
    2
  )}\n`
);

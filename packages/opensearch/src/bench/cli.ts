import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SEARCH_ENGINE_NAMES } from "../search/types.ts";
import { aggregateProbes } from "./aggregate.ts";
import { type CliOptions, parseArgs } from "./args.ts";
import {
  buildOfflineReport,
  loadQueries,
  OFFLINE_NUM_RESULTS,
} from "./fixtures.ts";
import { buildCharts } from "./render.ts";
import {
  buildReport,
  diffBaseline,
  toJsonReport,
  toMarkdownTable,
} from "./report.ts";
import type { BenchReport, ProviderReport } from "./types.ts";

const DEFAULT_LIVE_NUM_RESULTS = 10;
const DEFAULT_DEADLINE_MS = 15_000;

function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

function err(message: string): void {
  process.stderr.write(`${message}\n`);
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeChartSvgs(report: BenchReport, dir: string): void {
  const charts = buildCharts(report);
  for (const [name, svgContent] of Object.entries(charts)) {
    writeFile(join(dir, `${name}.svg`), svgContent);
  }
  out(`Wrote ${Object.keys(charts).length} chart SVG(s) to ${dir}`);
}

function writeOutputs(report: BenchReport, options: CliOptions): void {
  const json = toJsonReport(report);
  if (options.out !== undefined) {
    writeFile(options.out, `${json}\n`);
    out(`Wrote JSON report to ${options.out}`);
  }
  if (options.markdown !== undefined) {
    writeFile(options.markdown, `${toMarkdownTable(report)}\n`);
    out(`Wrote markdown table to ${options.markdown}`);
  }
  if (options.charts !== undefined) {
    writeChartSvgs(report, options.charts);
  }
  if (
    options.out === undefined &&
    options.markdown === undefined &&
    options.charts === undefined
  ) {
    out(toMarkdownTable(report));
  }
}

function historyLine(report: BenchReport, date: string): string {
  const rows = report.providers.map((provider: ProviderReport) => ({
    blockedRate: provider.blockedRate,
    consensus: provider.consensus,
    engine: provider.engine,
    fillRate: provider.fillRate,
    latencyP50Ms: provider.latencyP50Ms,
    latencyP95Ms: provider.latencyP95Ms,
    ndcgAtK: provider.ndcgAtK,
    qualityScore: provider.qualityScore,
    rate429Rate: provider.rate429Rate,
    rateLimitRate: provider.rateLimitRate,
    successRate: provider.successRate,
    timeoutRate: provider.timeoutRate,
  }));
  return JSON.stringify({
    date,
    providers: rows,
    qualityScoreVersion: report.meta.qualityScoreVersion,
  });
}

function reportDrift(report: BenchReport, baselinePath: string): void {
  let baselineRaw: string;
  try {
    baselineRaw = readFileSync(baselinePath, "utf-8");
  } catch {
    err(`No baseline at ${baselinePath}; skipping drift check.`);
    return;
  }
  const baseline = JSON.parse(baselineRaw) as BenchReport;
  const regressions = diffBaseline(report, baseline);
  if (regressions.length === 0) {
    out("No metric regressions beyond tolerance.");
    return;
  }
  err(`Detected ${regressions.length} metric regression(s):`);
  for (const regression of regressions) {
    err(
      `  ${regression.engine}.${regression.metric}: ${regression.baseline.toFixed(3)} -> ${regression.current.toFixed(3)} (Δ ${regression.delta.toFixed(3)})`
    );
  }
}

async function runLive(options: CliOptions): Promise<BenchReport> {
  // Dynamic import so the offline path never loads the heavy provider graph.
  const { getSearchProviders } = await import("../search/providers.ts");
  const { runBenchmark } = await import("./runner.ts");

  const numResults = options.numResults ?? DEFAULT_LIVE_NUM_RESULTS;
  const topK = options.topK ?? numResults;
  const queries = loadQueries(options.queries);
  const allProviders = getSearchProviders();
  const providers = allProviders.filter(
    (provider) => !options.exclude.has(provider.name)
  );

  out(
    `Live benchmark: ${providers.length} provider(s), ${queries.length} query(ies), numResults=${numResults}`
  );

  const probes = await runBenchmark({
    concurrency: options.concurrency,
    deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    numResults,
    providers,
    queries,
  });
  const reports = aggregateProbes(probes, queries, numResults, topK);
  return buildReport({
    expectedEngines: [...SEARCH_ENGINE_NAMES],
    generatedAt: new Date().toISOString(),
    mode: "live",
    numResults,
    queryCount: queries.length,
    reports,
    topK,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const report =
    options.mode === "live"
      ? await runLive(options)
      : buildOfflineReport(options.numResults ?? OFFLINE_NUM_RESULTS);

  writeOutputs(report, options);

  if (options.mode === "live" && options.history !== undefined) {
    mkdirSync(dirname(options.history), { recursive: true });
    appendFileSync(
      options.history,
      `${historyLine(report, new Date().toISOString())}\n`
    );
    out(`Appended history line to ${options.history}`);
  }

  if (options.mode === "live" && options.baseline !== undefined) {
    reportDrift(report, options.baseline);
  }
}

main().catch((error: unknown) => {
  err(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

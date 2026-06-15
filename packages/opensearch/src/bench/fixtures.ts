import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { aggregateProbes } from "./aggregate.ts";
import { buildReport } from "./report.ts";
import type { BenchQuery, BenchReport, ProbeOutcome } from "./types.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");

/** numResults used for the deterministic offline fixtures. */
export const OFFLINE_NUM_RESULTS = 5;

function readJson<T>(file: string): T {
  // A bare filename ("queries.json") is resolved against the bundled fixtures; a
  // path with separators is taken as-is (absolute, or relative to the cwd), so a
  // caller-supplied --queries path is not double-joined onto the fixtures dir.
  const path =
    isAbsolute(file) || file.includes("/") ? file : join(fixturesDir, file);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function loadQueries(file = "queries.json"): BenchQuery[] {
  return readJson<BenchQuery[]>(file);
}

export function loadProbes(file = "probes.json"): ProbeOutcome[] {
  return readJson<ProbeOutcome[]>(file);
}

/**
 * Build the deterministic offline report from committed fixtures. Shared by the
 * golden-file test (the per-PR gate) and the CLI `--offline` path so both compute
 * metrics identically.
 */
export function buildOfflineReport(
  numResults: number = OFFLINE_NUM_RESULTS
): BenchReport {
  const queries = loadQueries();
  const probes = loadProbes();
  const reports = aggregateProbes(probes, queries, numResults);
  return buildReport({
    mode: "offline",
    numResults,
    queryCount: queries.length,
    reports,
    topK: numResults,
  });
}

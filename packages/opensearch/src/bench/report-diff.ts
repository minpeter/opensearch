import type { BenchReport, ProviderReport } from "./types.ts";

export interface MetricRegression {
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
  readonly engine: string;
  readonly metric: string;
  readonly tolerance: number;
}

/** Metrics where a DROP beyond tolerance is a regression. */
const HIGHER_IS_BETTER = ["successRate", "fillRate", "qualityScore"] as const;
/** Metrics where a RISE beyond tolerance is a regression. */
const LOWER_IS_BETTER = ["rateLimitRate", "timeoutRate"] as const;

type TrackedMetric =
  | (typeof HIGHER_IS_BETTER)[number]
  | (typeof LOWER_IS_BETTER)[number];

/**
 * Compare a live report against a baseline and flag meaningful drift. Intended
 * for the live monitor only; the offline gate uses an exact golden-file assertion
 * because synthetic fixtures are deterministic.
 */
export function diffBaseline(
  current: BenchReport,
  baseline: BenchReport,
  tolerance = 0.15
): MetricRegression[] {
  const baselineByEngine = new Map(
    baseline.providers.map((report) => [report.engine, report])
  );
  const currentEngines = new Set(
    current.providers.map((report) => report.engine)
  );
  const regressions: MetricRegression[] = [];

  for (const report of current.providers) {
    const before = baselineByEngine.get(report.engine);
    if (before === undefined) {
      continue;
    }
    for (const metric of HIGHER_IS_BETTER) {
      pushRegression(
        regressions,
        report.engine,
        metric,
        before,
        report,
        tolerance,
        true
      );
    }
    for (const metric of LOWER_IS_BETTER) {
      pushRegression(
        regressions,
        report.engine,
        metric,
        before,
        report,
        tolerance,
        false
      );
    }
  }

  for (const before of baseline.providers) {
    if (currentEngines.has(before.engine) || before.successRate <= tolerance) {
      continue;
    }
    regressions.push({
      baseline: before.successRate,
      current: 0,
      delta: -before.successRate,
      engine: before.engine,
      metric: "successRate",
      tolerance,
    });
  }

  return regressions;
}

function pushRegression(
  out: MetricRegression[],
  engine: string,
  metric: TrackedMetric,
  before: ProviderReport,
  current: ProviderReport,
  tolerance: number,
  higherIsBetter: boolean
): void {
  const baselineValue = before[metric];
  const currentValue = current[metric];
  const delta = currentValue - baselineValue;
  const regressed = higherIsBetter ? delta < -tolerance : delta > tolerance;
  if (regressed) {
    out.push({
      baseline: baselineValue,
      current: currentValue,
      delta,
      engine,
      metric,
      tolerance,
    });
  }
}

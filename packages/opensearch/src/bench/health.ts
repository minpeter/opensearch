import type { BenchReport } from "./types.ts";

export const DEFAULT_MIN_PROVIDER_SUCCESS_RATE = 0.5;
export const DEFAULT_MIN_SUCCESSFUL_PROVIDERS = 1;

export interface MonitorHealth {
  readonly healthy: boolean;
  readonly healthyProviders: readonly string[];
  readonly reasons: readonly string[];
}

export interface MonitorHealthOptions {
  readonly minProviderSuccessRate?: number;
  readonly minSuccessfulProviders?: number;
}

/** Evaluate providers individually so aggregate averages cannot hide outages. */
export function evaluateMonitorHealth(
  report: BenchReport,
  options: MonitorHealthOptions = {}
): MonitorHealth {
  const minProviderSuccessRate =
    options.minProviderSuccessRate ?? DEFAULT_MIN_PROVIDER_SUCCESS_RATE;
  const minSuccessfulProviders =
    options.minSuccessfulProviders ?? DEFAULT_MIN_SUCCESSFUL_PROVIDERS;
  const healthyProviders = report.providers
    .filter(
      (provider) =>
        provider.probeCount > 0 &&
        provider.successRate >= minProviderSuccessRate
    )
    .map((provider) => provider.engine);
  const reasons: string[] = [];

  if (report.providers.length === 0) {
    reasons.push("No providers were measured.");
  }
  if (healthyProviders.length < minSuccessfulProviders) {
    reasons.push(
      `Only ${healthyProviders.length} provider(s) met the ${minProviderSuccessRate.toFixed(2)} success-rate floor; ${minSuccessfulProviders} required.`
    );
  }

  return {
    healthy: reasons.length === 0,
    healthyProviders,
    reasons,
  };
}

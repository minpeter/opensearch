import type { ProviderReport } from "./types.ts";

export type Tier = "S" | "A" | "B" | "C" | "D";

export const TIERS: readonly Tier[] = ["S", "A", "B", "C", "D"];

/** Tier-list colors (S hottest → D coolest). */
export const TIER_COLORS: Readonly<Record<Tier, string>> = {
  A: "#f97316",
  B: "#eab308",
  C: "#22c55e",
  D: "#3b82f6",
  S: "#ef4444",
};

const TIER_CUTOFFS: readonly { readonly tier: Tier; readonly min: number }[] = [
  { min: 0.8, tier: "S" },
  { min: 0.65, tier: "A" },
  { min: 0.5, tier: "B" },
  { min: 0.35, tier: "C" },
  { min: 0, tier: "D" },
];

/** Weight of reliability (successRate) when folding it into the tier score. */
const RELIABILITY_FLOOR = 0.5;

export interface TierAssignment {
  readonly engine: string;
  readonly qualityScore: number;
  readonly successRate: number;
  readonly tier: Tier;
  readonly tierScore: number;
}

/**
 * Tiering blends quality with reliability so a provider that fails often cannot
 * sit in a top tier on quality alone: a 100%-success provider keeps its full
 * qualityScore, a 0%-success one is halved.
 */
export function tierScoreOf(report: ProviderReport): number {
  return (
    report.qualityScore *
    (RELIABILITY_FLOOR + (1 - RELIABILITY_FLOOR) * report.successRate)
  );
}

export function tierFor(score: number): Tier {
  for (const cutoff of TIER_CUTOFFS) {
    if (score >= cutoff.min) {
      return cutoff.tier;
    }
  }
  return "D";
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Assign a tier to every provider, sorted best-first. */
export function assignTiers(
  reports: readonly ProviderReport[]
): TierAssignment[] {
  return reports
    .map((report) => {
      const tierScore = tierScoreOf(report);
      return {
        engine: report.engine,
        qualityScore: round4(report.qualityScore),
        successRate: round4(report.successRate),
        tier: tierFor(tierScore),
        tierScore: round4(tierScore),
      };
    })
    .sort((a, b) => b.tierScore - a.tierScore);
}

/** Group assignments by tier, preserving tier order and within-tier ranking. */
export function groupByTier(
  assignments: readonly TierAssignment[]
): { tier: Tier; members: TierAssignment[] }[] {
  return TIERS.map((tier) => ({
    members: assignments.filter((assignment) => assignment.tier === tier),
    tier,
  }));
}

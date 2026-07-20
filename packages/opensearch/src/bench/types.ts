import type {
  EngineFailureKind,
  SearchEngineName,
  SearchResult,
} from "../search/types.ts";

/**
 * A single benchmark query. `relevant` holds golden labels — either bare hosts
 * ("tokio.rs") or full URLs ("https://tokio.rs/tokio/tutorial"). Queries without
 * labels still contribute LIMIT and intrinsic/consensus QUALITY metrics, but are
 * excluded from golden precision/recall/MRR/nDCG aggregation.
 */
export interface BenchQuery {
  readonly query: string;
  readonly relevant?: readonly string[];
}

/**
 * The raw outcome of probing one provider with one query. This is the only thing
 * the runner produces; every downstream metric is derived from a list of these,
 * which keeps the metric layer pure and deterministic.
 */
export interface ProbeOutcome {
  readonly engine: SearchEngineName;
  /** SearchEngineError.kind when the probe failed, else undefined. */
  readonly errorKind?: EngineFailureKind;
  readonly latencyMs: number;
  /** Error message, retained so timeout/rate-limit can be detected heuristically. */
  readonly message?: string;
  readonly ok: boolean;
  readonly query: string;
  readonly results: readonly SearchResult[];
  /** HTTP status when the failure carried one (only the HTTP path attaches it). */
  readonly status?: number;
  /** True when the runner's own deadline fired or the message looks like a timeout. */
  readonly timedOut: boolean;
}

/**
 * Intrinsic, ground-truth-free QUALITY heuristics over a single result set.
 * `termCoverage` is null when the query has no usable terms after tokenization.
 */
export interface IntrinsicMetrics {
  readonly avgSnippetLength: number;
  /** results / requested, clamped to [0,1]; 0 for failed probes. */
  readonly fillRate: number;
  readonly resultCount: number;
  readonly snippetFillRate: number;
  readonly termCoverage: number | null;
  readonly titleFillRate: number;
  /** Unique canonical URLs / total; 1 means no duplicates. */
  readonly uniqueRatio: number;
  /** Fraction of results whose URL parses and is http(s). */
  readonly urlValidityRate: number;
}

/** Labeled-relevance QUALITY metrics for one query; null when the query has no labels. */
export interface GoldenMetrics {
  readonly hits: number;
  readonly k: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly relevantCount: number;
}

/** Per-provider aggregate across the whole query set. */
export interface ProviderReport {
  readonly avgSnippetLength: number;
  readonly blockedRate: number;
  readonly consensus: number | null;
  readonly engine: SearchEngineName;
  readonly failureCount: number;

  // --- LIMIT axis ---
  readonly fillRate: number;
  readonly labeledQueryCount: number;
  readonly latencyMeanMs: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly latencySampleCount: number;
  readonly lowConfidenceLatency: boolean;
  readonly misconfiguredRate: number;
  readonly mrr: number | null;
  readonly ndcgAtK: number | null;
  readonly noResultsRate: number;
  readonly precisionAtK: number | null;
  readonly probeCount: number;

  readonly qualityScore: number;
  readonly qualityScoreVersion: string;
  readonly rate429Rate: number;
  readonly rateLimitRate: number;
  readonly recallAtK: number | null;

  // --- QUALITY axis ---
  readonly snippetFillRate: number;
  readonly successCount: number;
  readonly successRate: number;
  readonly termCoverage: number | null;
  readonly timeoutRate: number;
  readonly titleFillRate: number;
  readonly uniqueRatio: number;
  readonly urlValidityRate: number;
}

export interface BenchReportMeta {
  /** ISO timestamp; omitted in deterministic offline output. */
  readonly generatedAt?: string;
  readonly labeledQueryCount: number;
  readonly mode: "offline" | "live";
  readonly numResults: number;
  readonly qualityScoreVersion: string;
  readonly qualityScoreWeights: Readonly<Record<string, number>>;
  readonly queryCount: number;
  readonly topK: number;
}

export interface BenchReport {
  readonly meta: BenchReportMeta;
  readonly providers: readonly ProviderReport[];
  /** Engine names that were expected but produced no probes (e.g. missing key). */
  readonly skipped: readonly string[];
}

/** Injectable monotonic clock (milliseconds). Defaults to performance.now(). */
export interface Clock {
  now: () => number;
}

# Provider metrics bench

Quantitative comparison of every search provider's **limit** and **search
quality**, in two modes:

| Mode | Command | When | Network |
| --- | --- | --- | --- |
| **offline** | `pnpm bench:offline` | every PR (gated) | none — deterministic fixtures |
| **live** | `pnpm bench:live` | scheduled CI / on demand | real provider APIs |

Both produce the same `BenchReport` shape: a JSON document and a markdown table
split into a LIMIT section and a QUALITY section.

```
pnpm --filter @minpeter/opensearch bench:offline -- --markdown /tmp/metrics.md
pnpm --filter @minpeter/opensearch bench:live -- \
  --num-results 10 --exclude DuckDuckGo \
  --out provider-metrics.json --markdown provider-metrics.md
```

The CLI runs through Node's native TypeScript type stripping
(`node --experimental-strip-types src/bench/cli.ts`), so no build step is needed.

## Pipeline

```
runner.ts   provider.search(query, n)  ──►  ProbeOutcome[]   (one real, un-cached,
            (single attempt, timed,                            un-retried attempt each)
             deadline-guarded)
metrics.ts  pure functions over results  ──►  per-probe metrics
aggregate.ts roll up per engine          ──►  ProviderReport[]
report.ts   round + render               ──►  BenchReport (JSON + markdown)
```

`runner.ts` is the only part that touches the network or the clock. Everything
downstream is pure and deterministic, which is what makes the offline gate exact.

## LIMIT metrics (per provider, fractions of probes unless noted)

- **fillRate** — `min(1, results / numRequested)`, averaged over **all** probes
  (a failed or no-results probe counts as 0). Providers self-slice to
  `numResults`, so fillRate is capped at 1 and over-return is invisible by design.
- **rate429Rate** — share of probes that failed with HTTP status 429 (the precise
  signal; only the HTTP path attaches a status).
- **blockedRate** — share classified `blocked` (403/429 or a detected bot wall).
- **rateLimitRate** — status 429 **or** (`blocked` with a 429/"rate limit"/"too
  many requests" message). This is the robust rate-limit signal, because MCP and
  scrape providers throw `blocked` without a status.
- **timeoutRate** — share that timed out, detected by the runner's own deadline
  (definitive) or a timeout-shaped error message (heuristic — providers wrap
  `TimeoutError` into a generic `transient` error and drop the name).
- **misconfiguredRate / noResultsRate** — share with those failure kinds.
- **latencyP50/P95/meanMs** — over **successful** probes only (timeouts would
  otherwise dominate p95). Nearest-rank percentile (`ceil`). `lowConfidenceLatency`
  flags fewer than 10 samples; such cells are marked `*` in the table.

## QUALITY metrics

Three independent lenses (no single lens is trusted alone):

**Intrinsic heuristics** (no ground truth; averaged over result-bearing probes):
snippetFillRate, titleFillRate, avgSnippetLength (report-only), urlValidityRate
(parses **and** http/https), uniqueRatio (distinct canonical URLs / total; 1 = no
dupes), termCoverage (share of query terms present in title+snippet, word-boundary
matched, stopwords dropped; null when the query has no usable terms).

**Cross-engine consensus** (relevance proxy, no labels): for each query a URL's
"consensus" is how many engines returned it. A provider's score is the mean, over
its top-k, of the fraction of **other** engines that also returned each URL. Self
is excluded, and the score is `null` (not 1.0) when no other engine participated.

**Labeled golden queries** (`relevant` URLs/hosts in `fixtures/queries.json`):
precision@k (over `min(k, results)`), recall@k, MRR, nDCG@k with binary gains.
Each label is credited once, at its first matching position, so nDCG stays in
[0,1] and domain repetition isn't rewarded. Host matching is dot-boundary safe
(`example.com` matches `docs.example.com` but not `notexample.com`). Queries
without labels are excluded from these means; `labeledQueryCount` reports how many
backed each number.

### Composite `qualityScore`

A weighted blend of `relevance` (nDCG), `consensus`, and a `heuristic` bundle
(mean of snippet/title/URL/term rates). Default weights — versioned as
`QUALITY_SCORE_VERSION` and asserted to sum to 1:

```
relevance 0.5 · heuristic 0.3 · consensus 0.2
```

Unavailable components are dropped and the remaining weights renormalized:
no labels → relevance drops; single-engine run → consensus drops. The heuristic
bundle is always present, so a score is always produced. **Treat LIMIT and the
three QUALITY lenses as the primary signals; the composite is a convenience
ranking, not ground truth.** Bump `QUALITY_SCORE_VERSION` on any weight/shape
change so historical numbers stay comparable.

## Determinism & the offline gate

`__tests__/golden.test.ts` recomputes the report from `fixtures/probes.json` +
`fixtures/queries.json` and asserts it equals `fixtures/golden-report.json`
(floats rounded to 4 dp). Any change to the metric math surfaces as a reviewed
diff to the golden file — regenerate it with:

```
pnpm --filter @minpeter/opensearch bench:offline -- --out src/bench/fixtures/golden-report.json
```

## Live monitoring

`.github/workflows/monitor.yml` runs `bench:live` weekly (and on demand). Only
providers whose secrets are present are measured; the rest appear under
`skipped`. Output is uploaded as the `provider-metrics` artifact (JSON + an
NDJSON history line) and rendered into the run summary. Pass `--baseline <json>`
to flag drift (`diffBaseline`) against a previous run.

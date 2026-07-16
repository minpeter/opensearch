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

## Fetch batch fan-out microbenchmark

`bench:fetch-batch` measures the scheduler around per-URL fetch fallbacks. Its
hypothesis is that bounded scheduling caps resource fan-out and that duplicate
inputs execute once, without changing result cardinality or order.

The default of eight is a conservative zero-config choice, not a universal
optimum: common small agent batches need few waves, while an unbounded direct
core call can no longer open an arbitrary number of operations. The current
adapters' 10-URL maximum needs at most two waves, but the core does not depend on
that adapter policy. Callers can choose a different positive integer when
latency, provider limits, or tenant budgets call for it. A hard 10-URL core limit
was rejected because it would invalidate legitimate TypeScript batch workloads;
a process-global semaphore was rejected because it would couple otherwise
isolated clients and tenants; splitting native provider batch requests was
rejected because it could increase upstream requests and cost.

```sh
pnpm --filter @minpeter/opensearch bench:fetch-batch
```

The fixed offline workload uses 100 inputs in two forms: 100 unique URLs, and 10
unique URLs repeated 10 times. An injected provider takes 5 ms per call, so the
benchmark performs no network I/O and consumes no provider quota. It warms up 3
times, measures 20 iterations, and gives each probe a 5000 ms deadline. Output
includes mean, p50, p95, min, and max latency plus provider calls, peak
concurrency, output count, and order preservation. Each probe creates a fresh
client and supplies `maxCharacters`, so no completed cache entry can affect the
result.

Measured on Linux x86_64 with Node v24.18.0. The before run used `49d3439` and
executed this benchmark body inline because the script did not exist there; the
after run used the checked-in command. Dependencies, workload, warm-up,
iterations, and timeout were otherwise identical.

| Workload / metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| 10 unique repeated / provider calls | 100 | 10 | -90 (-90%) |
| 10 unique repeated / peak concurrency | 100 | 8 | -92 (-92%) |
| 10 unique repeated / latency mean | 5.55 ms | 10.38 ms | +4.83 ms |
| 10 unique repeated / latency p50 / p95 | 5.58 / 5.74 ms | 10.32 / 10.45 ms | +4.74 / +4.71 ms |
| 10 unique repeated / min / max | 5.31 / 5.86 ms | 10.25 / 11.40 ms | — |
| 100 unique / provider calls | 100 | 100 | 0 |
| 100 unique / peak concurrency | 100 | 8 | -92 (-92%) |
| 100 unique / latency mean | 5.42 ms | 66.68 ms | +61.26 ms |
| 100 unique / latency p50 / p95 | 5.34 / 5.65 ms | 66.76 / 67.69 ms | +61.42 / +62.04 ms |
| 100 unique / min / max | 5.27 / 5.87 ms | 65.34 / 67.96 ms | — |

Both before and after returned all 100 results in input order in every measured
iteration. The added latency is expected: the synthetic 5 ms operations now run
in waves of at most eight instead of all at once. The numbers are a deterministic
scheduler proxy, not production latency or throughput predictions; they exclude
real network variance and provider-side batching. The limit is per fetch call and
does not coordinate separate clients or constrain fan-out performed internally
by a provider's own batch operation.

The root and Node runtime export counts stayed at 10 and 11 respectively; this
change adds optional fields, not a new top-level export. An esbuild bundle under
the same `workerd`, `worker`, and `browser` conditions grew from 670,200 to
672,721 bytes (+2,521, +0.38%), or from 104,278 to 104,809 gzip bytes (+531,
+0.51%). The edge verifier still sees 83 modules and no Node-only dependency,
static `node:` import, or Node global.

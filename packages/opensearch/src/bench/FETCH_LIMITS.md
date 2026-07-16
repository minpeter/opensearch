# Fetch output-limit experiment

## Problem and hypothesis

`FetchOptions.maxCharacters` was forwarded to batch-capable providers but was
not enforced by the core. A local fallback, public API, or provider that ignored
the hint could return arbitrarily more extracted content. The single-URL path
also skipped the documented 12,000-character default.

This affects every adapter because both `opensearch-ai-sdk` and
`opensearch-mcp` return the core result directly. The hypothesis was that a
provider-independent postcondition in fetch orchestration would raise output
limit compliance to 100% without changing result order, metadata, routing, or
the public export surface.

## Workload and method

The offline workload uses a deterministic in-process local provider that always
returns a 20,000-character fixture and deliberately ignores the requested
limit. It covers:

- one URL with an explicit 1,000-character limit;
- two URLs with the same explicit limit;
- one URL with the documented default 12,000-character limit.

Run it with:

```sh
pnpm --filter @minpeter/opensearch bench:fetch-limits
```

The measurement uses five warm-up iterations and 50 measured iterations per
workload. The batch case therefore has 100 result samples; each single case has
50. There is no network, retry, or timeout because the fixture provider resolves
in-process. Before and after used the same Node v24.18.0 Linux x86_64 runtime,
fixture, warm-up, iteration count, and compliance calculation. The committed
script is the exact post-change harness; the same harness was run against the
pre-change implementation for the baseline.

A sample is compliant only when `content.length <= limit` and the result's
`length` metadata exactly matches `content.length`.

## Results

| Workload | Samples | Before compliant | After compliant | Before max length | After max length | Max overflow change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Single, explicit 1,000 | 50 | 0/50 (0%) | 50/50 (100%) | 20,000 | 1,000 | 19,000 → 0 |
| Batch, explicit 1,000 | 100 | 0/100 (0%) | 100/100 (100%) | 20,000 | 1,000 | 19,000 → 0 |
| Single, default 12,000 | 50 | 0/50 (0%) | 50/50 (100%) | 20,000 | 12,000 | 8,000 → 0 |

All 200 measured results changed from non-compliant to compliant. Because each
fixture has a fixed size, observed length had zero within-workload variance in
both runs; the table reports every sample rather than only a mean.

An isolated build of `origin/main` and the merged output-limit checkpoint used
the same lockfile and tsdown/esbuild browser conditions. The edge bundle stayed
at 83 modules and changed from 672,721 to 673,441 raw bytes (+720, +0.11%) and
from 104,809 to 104,954 gzip bytes (+145, +0.14%). The shared core chunk
accounts for the added validation and postcondition.

## Implementation and alternatives

Fetch orchestration now validates that the effective limit is a positive safe
integer and truncates the final `FetchResult` after any provider or fallback.
When truncation occurs, `length` is recomputed while `title`, `url`, ordering,
and the stable result schema are preserved. Results already within the limit
are returned unchanged.

Alternatives considered:

- Provider-specific truncation was rejected because every new provider could
  reintroduce the gap.
- Adapter-only truncation was rejected because direct core consumers would keep
  inconsistent behavior.
- Capping response bytes before extraction was kept as a separate follow-up: it
  can reduce network and memory use, but it changes extraction completeness and
  needs content-type-aware measurement.

## Compatibility, trade-offs, and limits

This corrects a documented contract but changes the previously unlimited
single-URL default. A caller intentionally relying on more than 12,000 returned
characters can migrate explicitly, for example
`fetch(url, { maxCharacters: 100_000 })`. No export or type was removed.

The benchmark proves the returned-result boundary, not upstream request size,
downloaded bytes, extractor peak memory, or semantic preservation at the cut
point. It also uses a synthetic provider so it cannot estimate live-provider
latency or content-quality changes. A future response-size experiment should
measure HTML/PDF/feed extraction success and memory before adding an early byte
cap.

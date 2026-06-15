# Provider limits reference

A code-level audit of how each search provider handles result **limits**, **rate
limits**, and **timeouts**. This is the static, structural companion to the live
numbers produced by [`src/bench`](./src/bench/README.md) — use the bench for
observed fill-rate / latency / quality, and this table for the contract behind
those numbers. Derived from a source audit of `src/search/providers/*`.

Columns:

- **Key?** — works with no API key/credential (always available in the chain).
- **Limit mechanism** — how `numResults` is honored: `request-param` (sent to the
  API), `slice` (trimmed locally), `both`, or `none` (only the fallback chain
  trims afterward, e.g. scrape providers).
- **Count param** — the request field carrying the count, when any.
- **429** — surfaces a rate-limit signal the bench can see: `status` (HTTP 429
  attached), `blocked` (mapped to the blocked kind), or `—` (not distinguished).
- **Key pool** — rotates across pooled keys on 429.
- **Timeout** — request timeout. All HTTP providers use the shared
  `REQUEST_TIMEOUT_MS = 8000`; TinyFish uses its own constant.

## Keyless providers (standalone entries in the chain)

These are the engines `getSearchProviders` adds with no key, so they are exactly
what a keyless live run measures:

| Engine | Limit mechanism | Count param | 429 | Timeout |
| --- | --- | --- | --- | --- |
| DuckDuckGo | none (scrape) → JSON API on block | — | blocked | 8000 |
| Bing | none (scrape) / both (augmented) | — | blocked | 8000 |
| Startpage | slice | — | — | 8000 |
| Webcrawler | slice | — | — | 8000 |
| Exa (MCP) | request-param | `numResults` | blocked | 8000 |
| Parallel (MCP) | slice | — | blocked | 8000 |

**Augmented-Bing supplemental source** — when zero-key providers are enabled, the
Bing provider additionally queries keyless **Wikipedia** (`srlimit`); its results
surface under the `Bing` engine, so it is not benchmarked as a standalone row.
(Wiby and InternetArchive supplements were removed — the bench's answer-page
audit found their results were almost always off-topic noise in the top spots.)

**SearxNG** is keyless but only added when `OPENSEARCH_SEARXNG_URLS` is set, so it
is config-gated rather than always-on.

## Keyed providers

| Engine | Count param | 429 | Key pool | Cap | Timeout |
| --- | --- | --- | --- | --- | --- |
| Brave | `count` | status | yes | — | 8000 |
| Google | `num` | status | yes | **10** | 8000 |
| Serper | `num` | status | yes | — | 8000 |
| SerpAPI | `num` | status | yes | — | 8000 |
| SearchAPI | `num` | status | yes | — | 8000 |
| BrightData | `num` | status | yes | — | 8000 |
| ScrapingBee | `nb_results` | status | yes | — | 8000 |
| DataForSEO | `depth` | status | yes | — | 8000 |
| Tavily | `max_results` | status | yes | — | 8000 |
| Perplexity | `max_results` | status | yes | — | 8000 |
| Valyu | `max_num_results` | status | yes | — | 8000 |
| Kagi | `limit` | status | yes | — | 8000 |
| Linkup | `limit` | status | yes | — | 8000 |
| Firecrawl | `limit` | status | yes | — | 8000 |
| Mojeek | `s` | status | yes | — | 8000 |
| You | `count` | status | yes | — | 8000 |
| Exa (API) | `numResults` | status | yes | — | 8000 |
| Parallel (API) | — (objective) | status | yes | — | 8000 |
| TinyFish | — (slice only) | flattened to `transient` | own pool | — | own constant |

### DuckDuckGo anti-bot bypass

DuckDuckGo serves an HTTP 202 JavaScript proof-of-work challenge
(`DDG.deep.initialize(...)`) to flagged IPs instead of results. The provider
tries the lightweight `html.duckduckgo.com` scrape first; when that is
bot-blocked it escalates to the `links.duckduckgo.com` JSON API, solving the
proof-of-work headlessly (jsdom + a locked-down `node:vm` sandbox: eval disabled,
body size-capped, time-boxed) and resubmitting with the computed token. Opt out
with `OPENSEARCH_ENABLE_DUCKDUCKGO_POW=false`.

## Notes that affect the live metrics

- **Google caps at 10** results per request regardless of `numResults`, so its
  live `fillRate` cannot exceed `10 / numResults`. Request more than 10 and the
  gap is a cap, not a quality problem.
- **TinyFish** flattens any upstream error (including 429) to the `transient`
  kind, so its `rate429Rate` reads 0 even when throttled; it also uses a dedicated
  timeout constant rather than the shared 8000 ms.
- **Scrape / keyless** providers (DuckDuckGo, Bing) carry no HTTP status on
  blocks, so the bench's `rateLimitRate` relies on the `blocked` kind for them.
  The live monitor excludes them by default (`--exclude DuckDuckGo,Bing`) because
  a CI IP is frequently challenge-walled, which would otherwise distort the
  comparison.
- **MCP providers** (Exa/Parallel) map 429 by message substring and throw without
  a status, which is why `rateLimitRate` keys on the message as well as the status.

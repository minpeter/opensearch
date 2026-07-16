# Runtime hardening experiment

## Problems and hypotheses

The default per-client caches had no capacity bound, and the Node fetch pipeline
validated neither private destinations nor downloaded response size before
extraction. A generic public-API route also ran before the local fetch validator.
An intermediate bounded-cache implementation could re-fetch freshly produced
batch results after LRU eviction, and provider HTTP 451 failures could fall
through to another provider as if they were ordinary availability failures.
These gaps matter most in long-lived or multi-tenant agents: unique inputs could
grow memory indefinitely, and attacker-controlled URLs could reach local or
metadata services before the intended fallback boundary. Re-fetching defeated
the batch concurrency cap, while falling through a legal restriction violated
the runtime's non-bypass policy.

The hypotheses were:

1. a 256-entry LRU-like TTL cache would make retained entry count constant while
   preserving TTL, in-flight coalescing, and hit behavior;
2. one injected URL-policy seam before phase zero, plus connection-time DNS and
   redirect checks in Node, would reject private targets before network I/O,
   while an edge-safe invariant would reject non-HTTP URLs and URL userinfo
   before any hosted provider receives them;
3. bounded streaming reads would reject declared and chunked bodies above the
   configured byte budget without weakening the 12,000-character output limit
   or buffering MCP server-sent event streams;
4. batch-local result assembly would prevent cache eviction from duplicating
   provider work, and status-preserving error handling would make HTTP 451
   terminal while retaining ordinary 403/429 fallback behavior.

## Deterministic workloads and results

All workloads run in-process with mocked providers; they perform no external
network calls and have no timing variance.

| Check | Before | After | Change |
| --- | ---: | ---: | ---: |
| Resolved entries after 10,000 unique inserts | 10,000 | 256 | -9,744 (-97.44%) |
| Requests issued for `http://127.0.0.1/@admin` through a generic public-API route | 1 | 0 | eliminated |
| 65-byte streamed body under a 64-byte limit | accepted | rejected | limit enforced |
| Declared 1,000-byte body under a 64-byte limit | accepted | rejected before reading | limit enforced |
| Chunked MCP response crossing a 3-byte limit | accepted by the SDK transport | rejected while streaming | limit enforced |
| Provider calls for 5 fresh URLs with `maxEntries: 1` | 9 | 5 | -4 (-44.44%) |
| Downstream Exa MCP calls for 3 Ollama misses | 3 single calls | 1 batch call | -2 calls (-66.67%) |
| Next-provider calls after an HTTP 451 response | 1 | 0 | eliminated |
| Unconsumed response bodies after one non-success discovery response | 1 | 0 | eliminated |

The cache figure is an entry-count proxy, not a heap-byte measurement. Entries
have variable key and result sizes, so it proves bounded cardinality rather than
an exact memory reduction. The network tests cover loopback, RFC1918, link-local
metadata, IPv4-integer forms, IPv6 loopback/ULA, internal suffixes, URL userinfo,
non-HTTP schemes, and redirects to private targets. Optional TLS impersonation
and Playwright fallbacks have separate redirect/subrequest and response-size
regressions. Parallel and Exa MCP transports have separate declared-length and
chunked-body regressions, plus a non-buffering delivery check for SSE semantics.
Batch eviction and legal-restriction regressions verify that each fresh URL is
requested exactly once under the configured concurrency and that neither search,
hosted fetch, nor official public-API routing continues after HTTP 451.
The Ollama miss regression also verifies that per-URL opt-in probing does not
downgrade the remaining provider chain from native batch calls to single calls.
Archive and feed discovery regressions also verify that unused non-success
response streams are canceled before trying another endpoint.

Reproduce the checks with:

```sh
pnpm --filter @minpeter/opensearch exec vitest run \
  src/__tests__/cache.test.ts \
  src/__tests__/node-network-policy.test.ts \
  src/__tests__/node-tls-executor.test.ts \
  src/__tests__/node-playwright-executor.test.ts \
  src/__tests__/response-body.test.ts \
  src/__tests__/parallel-mcp.test.ts \
  src/__tests__/exa-mcp.test.ts
```

## Compatibility and bundle cost

Cache defaults remain enabled with the existing three-minute TTL. New clients
retain at most 256 resolved entries; callers can set `cache.maxEntries`,
`cache.ttlMs`, or `cache.enabled`. Node local downloads default to 10 MiB and
five redirects. Intentional intranet users can opt in with
`fetch.allowPrivateNetwork`.

Using the same tsdown build and esbuild `workerd`, `worker`, and `browser`
conditions as the edge safety gate, the root edge bundle remained at 83 modules.
Relative to `origin/main` (673,441 raw / 104,954 gzip bytes), the complete
hardening, observability, and Ollama change is 705,869 raw / 111,067 gzip bytes:
+32,428 (+4.82%) raw and +6,113 (+5.82%) gzip. No Node-only dependency, static
`node:` import, Node global, `undici`, local extractor, or DuckDuckGo module
entered the edge graph.

## Trade-offs and remaining limits

- Eviction may turn a formerly retained old result into a provider request; the
  bounded memory policy is intentional and configurable per client.
- Undici enforces resolved-address policy at connection time. Native TLS and
  browser fallbacks can validate URLs and redirects but cannot pin their native
  resolver to that validation, so an external egress firewall remains necessary
  for hostile multi-tenant workloads.
- Playwright checks serialized HTML after rendering; it does not cap all browser
  resource allocation before the page is serialized.
- Hosted providers receive target URLs and enforce their own SSRF, retention,
  quota, and billing policies.
- The byte limit protects retained response bodies, not total decompressor or
  parser peak memory. Content-type-specific memory profiling remains a useful
  follow-up.

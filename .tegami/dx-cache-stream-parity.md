---
packages:
  npm:@minpeter/opensearch:
    type: minor
  npm:opensearch-mcp:
    type: patch
  npm:opensearch-ai-sdk:
    type: patch
---

### Unify cache behavior and add streaming search

- `search` now retries transient failures and caches results on every
  entrypoint (previously the internal single-pass path was exposed
  inconsistently), and repeated or overlapping calls coalesce into one
  provider request.
- New per-call `cache: "bypass"` option on `search`, `searchWithRetryAndCache`,
  and `fetch` for calls that must hit the provider.
- New `searchStream` async generator (module level and client) that fans out
  to every configured provider concurrently and yields each provider's results
  as they arrive; if every provider fails it throws the same aggregated
  `SearchExecutionError` as `search`.
- `fetch` overloads now accept a `string | readonly string[]` union argument
  directly, and `OpenSearchClient.search` accepts an optional call-options
  parameter.
- Live bench monitor now uses the larger 8-query live fixture for tighter
  latency percentiles, and PROVIDERS.md documents observed keyless quality and
  rate-limit guidance.

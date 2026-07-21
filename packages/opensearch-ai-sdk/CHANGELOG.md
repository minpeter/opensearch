## opensearch-ai-sdk@0.0.10

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

## opensearch-ai-sdk@0.0.7

### Adapt to ai SDK v7 types

Update type definitions for ai SDK v7 compatibility:
`ToolExecutionOptions` is now generic, `OpenSearchToolSet` no longer
extends ai's `ToolSet` (index signature incompatibility), and method
signatures use property-style for stricter function type checking.

## opensearch-ai-sdk@0.0.6

### Add opt-in Ollama web search and fetch

Add Ollama local-daemon and cloud web tools behind
`OPENSEARCH_ENABLE_OLLAMA=true`. Node can use the signed-in local daemon while
edge stays cloud-only. Preserve the shared account quota by avoiding a duplicate
cloud request after local 429 responses, bound provider responses, and include
Ollama in core, AI SDK, and MCP result schemas. Preserve native downstream
batching when Ollama cannot serve only some or all requested URLs.

### Bound caches and harden Node fetches

Bound per-client search and fetch caches, expose cache policy options, reject
non-HTTP URLs and URL userinfo in every runtime, reject private and unsafe Node
fetch destinations before provider routing, validate
redirects, and cap retained downloads. Add structured operation, cache,
provider, fallback, failure, and latency events through an edge-safe client sink;
AI SDK options pass the sink through and MCP can emit sanitized JSON events.
Keep batch assembly within its concurrency bound after cache eviction, and stop
provider fallback on HTTP 451 legal restrictions. Cancel unused non-success
response bodies so provider and discovery connections can be reclaimed.

### Repair package installation and release verification

Publish adapter dependencies as real semver ranges instead of workspace
protocols. Add clean tarball installation and entrypoint smoke tests, verify
registry packages only on actual publish runs, and update release, dependency,
security, coverage, and Node 22/24 CI gates.

## opensearch-ai-sdk@0.0.5

### Enforce page content limits across every fetch path

Apply the requested `maxCharacters` limit, or the documented 12,000-character
default, after every fetch provider and fallback. This keeps core, AI SDK, and
MCP results within the same output budget even when an upstream provider ignores
the requested limit, and rejects invalid limits instead of forwarding them.

# opensearch-ai-sdk

## 0.0.3

### Patch Changes

- Updated dependencies [900a772]
  - @minpeter/opensearch@0.0.4

## 0.0.2

### Patch Changes

- 3e25c40: docs: add minimal READMEs to all packages, slim root README
- Updated dependencies [3e25c40]
  - @minpeter/opensearch@0.0.3

## 0.0.1

### Patch Changes

- e6158e2: Add the OpenSearch AI SDK tools package scaffold.
- Updated dependencies [6e19a13]
  - @minpeter/opensearch@0.0.2

---
packages:
  "npm:@minpeter/opensearch": patch
  "npm:opensearch-ai-sdk": patch
  "npm:opensearch-mcp": patch
---

## Bound caches and harden Node fetches

Bound per-client search and fetch caches, expose cache policy options, reject
non-HTTP URLs and URL userinfo in every runtime, reject private and unsafe Node
fetch destinations before provider routing, validate
redirects, and cap retained downloads. Add structured operation, cache,
provider, fallback, failure, and latency events through an edge-safe client sink;
AI SDK options pass the sink through and MCP can emit sanitized JSON events.
Keep batch assembly within its concurrency bound after cache eviction, and stop
provider fallback on HTTP 451 legal restrictions. Cancel unused non-success
response bodies so provider and discovery connections can be reclaimed.

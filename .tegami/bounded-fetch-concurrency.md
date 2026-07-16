---
packages:
  "npm:@minpeter/opensearch": patch
---

## Bound batch fetch concurrency

Deduplicate repeated URLs in batch fetches and cap per-URL provider work at eight
concurrent operations by default. Clients can configure `fetch.maxConcurrency`,
and individual `fetch` calls can override it without changing result order or
cardinality.

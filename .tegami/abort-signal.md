---
packages:
  "npm:@minpeter/opensearch": patch
---

## Add per-call AbortSignal support

- Export per-call `AbortSignal` options for fetch and search.
- Propagate caller cancellation through default Node fetch and search boundaries,
  retries, fallbacks, and shared cached operations without allowing one caller
  to cancel work shared by unrelated callers.

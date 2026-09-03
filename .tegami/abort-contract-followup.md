---
packages:
  "npm:@minpeter/opensearch": patch
---

## Harden abort contracts

- Preserve explicit abort reasons, reject pre-aborted public calls asynchronously,
  and keep stalled response-body cleanup cancellable.
- Avoid starting cache generations for callers that already cancelled.

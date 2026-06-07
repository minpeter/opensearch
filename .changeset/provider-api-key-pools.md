---
"@minpeter/opensearch": minor
"opensearch-mcp": patch
---

Allow credential-backed search and fetch providers to accept semicolon-delimited API key pools. HTTP 429 responses retry the next key or credential pair inside the same provider before falling back, while malformed and no-result responses preserve the existing fallback chain.

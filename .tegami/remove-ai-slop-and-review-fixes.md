---
packages:
  npm:@minpeter/opensearch:
    type: patch
  npm:opensearch-mcp:
    type: patch
---

### Remove AI slop, split oversized modules, and fix review findings

Behavior-preserving cleanup across the codebase: deduplicated control flow,
removed dead code, and split every module over 250 pure LOC by responsibility
(including the 560-line provider fallback chain). Also fixes from PR review:

- Firecrawl endpoint resolution preserves proxy prefixes and query parameters
- Batch fetch results map by requested URL and concurrent cache misses now
  coalesce into single-flight work
- TLS fallback always enforces the redirect limit and reads bodies through the
  bounded reader
- Playwright cleanup no longer masks fetch outcomes
- Ollama rejects single-slash host schemes and parses Retry-After HTTP dates
- MCP tool errors preserve messages from plain-object errors

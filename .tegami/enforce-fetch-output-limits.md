---
packages:
  "npm:@minpeter/opensearch": patch
  "npm:opensearch-ai-sdk": patch
  "npm:opensearch-mcp": patch
---

## Enforce page content limits across every fetch path

Apply the requested `maxCharacters` limit, or the documented 12,000-character
default, after every fetch provider and fallback. This keeps core, AI SDK, and
MCP results within the same output budget even when an upstream provider ignores
the requested limit, and rejects invalid limits instead of forwarding them.

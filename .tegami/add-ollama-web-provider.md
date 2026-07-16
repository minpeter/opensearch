---
packages:
  "npm:@minpeter/opensearch": patch
  "npm:opensearch-ai-sdk": patch
  "npm:opensearch-mcp": patch
---

## Add opt-in Ollama web search and fetch

Add Ollama local-daemon and cloud web tools behind
`OPENSEARCH_ENABLE_OLLAMA=true`. Node can use the signed-in local daemon while
edge stays cloud-only. Preserve the shared account quota by avoiding a duplicate
cloud request after local 429 responses, bound provider responses, and include
Ollama in core, AI SDK, and MCP result schemas. Preserve native downstream
batching when Ollama cannot serve only some or all requested URLs.

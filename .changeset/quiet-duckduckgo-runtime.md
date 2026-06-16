---
"@minpeter/opensearch": patch
"opensearch-mcp": patch
---

Remove unreliable keyless Bing, Startpage, Webcrawler, and augmented-Bing fallbacks from the public search engine surface, and move DuckDuckGo into the Node runtime entrypoint as the final keyless fallback.

Update the MCP server to import the Node runtime entrypoint so `web_search` keeps the DuckDuckGo fallback.

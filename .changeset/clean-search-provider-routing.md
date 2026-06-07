---
"@minpeter/opensearch": minor
"opensearch-mcp": minor
---

Add a split search-provider architecture with optional Tavily, Firecrawl, Parallel, You.com, Perplexity, Serper, SerpAPI, DataForSEO, Kagi, Mojeek, SearxNG, Bright Data, ScrapingBee, SearchAPI.io, Valyu, Linkup, and Jina search routing.

Add Parallel's hosted Search MCP as a no-key default fallback, add verified keyless Startpage and Webcrawler standalone fallback routing, add an augmented Bing fallback that runs Bing, Wikipedia, Internet Archive, and Wiby in parallel, and update Jina Search to the current authenticated `s.jina.ai/<query>` markdown path.

Remove retired Azure Bing Web Search API routing, the removed Google HTML scrape opt-in, and Naver routing, document the current free/no-token coverage, and refresh package dependencies to their latest patch/minor releases.

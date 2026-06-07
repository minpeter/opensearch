# @minpeter/opensearch

## 0.0.0

### Minor Changes

- 0b45db2: Add a split search-provider architecture with optional Tavily, Firecrawl, Parallel, You.com, Perplexity, Serper, SerpAPI, DataForSEO, Kagi, Mojeek, SearxNG, Bright Data, ScrapingBee, SearchAPI.io, Valyu, Linkup, and Jina search routing.

  Add Parallel's hosted Search MCP as a no-key default fallback, add verified keyless Startpage and Webcrawler standalone fallback routing, add an augmented Bing fallback that runs Bing, Wikipedia, Internet Archive, and Wiby in parallel, and update Jina Search to the current authenticated `s.jina.ai/<query>` markdown path.

  Remove retired Azure Bing Web Search API routing, the removed Google HTML scrape opt-in, and Naver routing, document the current free/no-token coverage, and refresh package dependencies to their latest patch/minor releases.

- 0b45db2: Allow credential-backed search and fetch providers to accept semicolon-delimited API key pools. HTTP 429 responses retry the next key or credential pair inside the same provider before falling back, while malformed and no-result responses preserve the existing fallback chain.
- 0b45db2: Split the reusable web search and fetch runtime into `@minpeter/opensearch`, keeping the `opensearch-mcp` package as the stdio MCP server and CLI wrapper.

### Patch Changes

- 0b45db2: Set the new reusable `@minpeter/opensearch` package to a `0.0.0` initial version before the first library release.
- c69a1fd: Add TinyFish-backed `web_search` and `web_fetch` providers behind `TINYFISH_API_KEY`, preserving the existing MCP tool names and text-first responses.

## @minpeter/opensearch@0.1.0

### Unify cache behavior and add streaming search

- `search` now retries transient failures and caches results on every
  entrypoint (previously the internal single-pass path was exposed
  inconsistently), and repeated or overlapping calls coalesce into one
  provider request.
- New per-call `cache: "bypass"` option on `search`, `searchWithRetryAndCache`,
  and `fetch` for calls that must hit the provider.
- New `searchStream` async generator (module level and client) that fans out
  to every configured provider concurrently and yields each provider's results
  as they arrive; if every provider fails it throws the same aggregated
  `SearchExecutionError` as `search`.
- `fetch` overloads now accept a `string | readonly string[]` union argument
  directly, and `OpenSearchClient.search` accepts an optional call-options
  parameter.
- Live bench monitor now uses the larger 8-query live fixture for tighter
  latency percentiles, and PROVIDERS.md documents observed keyless quality and
  rate-limit guidance.

## @minpeter/opensearch@0.0.10

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

## @minpeter/opensearch@0.0.9

### Bump biome to 2.5.4 and ultracite to 7.9.4

Adopt biome 2.5.x lint rules across the codebase: property-style method
signatures, error cause propagation, destructuring, and targeted
suppressions for intentional sequential awaits and defensive guards.

## @minpeter/opensearch@0.0.8

### Bump undici to v8

Upgrade the HTTP client from undici 7 to undici 8. No API changes —
`Agent` and `Dispatcher` usage is unchanged. Requires Node >= 22.19.0.

## @minpeter/opensearch@0.0.7

### Add opt-in Ollama web search and fetch

Add Ollama local-daemon and cloud web tools behind
`OPENSEARCH_ENABLE_OLLAMA=true`. Node can use the signed-in local daemon while
edge stays cloud-only. Preserve the shared account quota by avoiding a duplicate
cloud request after local 429 responses, bound provider responses, and include
Ollama in core, AI SDK, and MCP result schemas. Preserve native downstream
batching when Ollama cannot serve only some or all requested URLs.

### Bound caches and harden Node fetches

Bound per-client search and fetch caches, expose cache policy options, reject
non-HTTP URLs and URL userinfo in every runtime, reject private and unsafe Node
fetch destinations before provider routing, validate
redirects, and cap retained downloads. Add structured operation, cache,
provider, fallback, failure, and latency events through an edge-safe client sink;
AI SDK options pass the sink through and MCP can emit sanitized JSON events.
Keep batch assembly within its concurrency bound after cache eviction, and stop
provider fallback on HTTP 451 legal restrictions. Cancel unused non-success
response bodies so provider and discovery connections can be reclaimed.

### Repair package installation and release verification

Publish adapter dependencies as real semver ranges instead of workspace
protocols. Add clean tarball installation and entrypoint smoke tests, verify
registry packages only on actual publish runs, and update release, dependency,
security, coverage, and Node 22/24 CI gates.

## @minpeter/opensearch@0.0.6

### Enforce page content limits across every fetch path

Apply the requested `maxCharacters` limit, or the documented 12,000-character
default, after every fetch provider and fallback. This keeps core, AI SDK, and
MCP results within the same output budget even when an upstream provider ignores
the requested limit, and rejects invalid limits instead of forwarding them.

## @minpeter/opensearch@0.0.5

### Bound batch fetch concurrency

Deduplicate repeated URLs in batch fetches and cap per-URL provider work at eight
concurrent operations by default. Clients can configure `fetch.maxConcurrency`,
and individual `fetch` calls can override it without changing result order or
cardinality.

# @minpeter/opensearch

## 0.0.4

### Patch Changes

- 900a772: Add public API, feed/archive, media, TLS, and Playwright fetch fallbacks while keeping fetch results on the stable title/content/url/length shape.

## 0.0.3

### Patch Changes

- 3e25c40: docs: add minimal READMEs to all packages, slim root README

## 0.0.2

### Patch Changes

- 6e19a13: Add Firecrawl no-key search and scrape fallbacks for zero-config web search and page fetch.

## 0.0.1

### Patch Changes

- 2c1ad5d: Organize provider implementations under consistent provider folders.
- c74bdfb: Remove unreliable keyless Bing, Startpage, Webcrawler, and augmented-Bing fallbacks from the public search engine surface, and move DuckDuckGo into the Node runtime entrypoint as the final keyless fallback.

  Update the MCP server to import the Node runtime entrypoint so `web_search` keeps the DuckDuckGo fallback.

- c74bdfb: Address PR review findings in the fetch resilience pipeline: stop routing legal (HTTP 451) blocks through the third-party reader so legal takedowns surface as errors, and recognize apex domains under compound TLDs (e.g. `example.co.uk`, `example.com.au`) when generating mobile/apex retry variants.

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

# opensearch-mcp

Zero-config web search and page fetch for MCP clients, backed by the reusable
`@minpeter/opensearch` runtime.

Use the MCP package when you want `web_search` and `web_fetch` in an agent. Use
the library package when you want the same routing and extraction behavior
directly from TypeScript. Use the AI SDK package when you want those capabilities
as Vercel AI SDK tools.

## Install

For MCP clients:

```json
{
  "mcpServers": {
    "opensearch": {
      "command": "npx",
      "args": ["-y", "opensearch-mcp"]
    }
  }
}
```

For application code:

```bash
pnpm add @minpeter/opensearch
```

For AI SDK applications:

```bash
pnpm add opensearch-ai-sdk ai
```

## MCP Server

`opensearch-mcp` exposes two stdio tools.

| Tool | Purpose |
|---|---|
| `web_search` | Searches the web and returns text-first results with title, URL, highlights, and source. |
| `web_fetch` | Reads one or more URLs and returns metadata plus clean markdown. |

### `web_search`

| Parameter | Type | Default | Notes |
|---|---:|---:|---|
| `query` | string | required | Natural-language search query. |
| `numResults` | number | `5` | Preferred result count, from 1 to 15. |
| `max_results` | number | `5` | Compatibility alias for `numResults`. |

Each result is rendered as:

```text
Title: ...
URL: ...
Highlights: ...
Source: ...
```

### `web_fetch`

| Parameter | Type | Default | Notes |
|---|---:|---:|---|
| `urls` | string[] | required | One to ten URLs. |
| `maxCharacters` | number | `12_000` | Optional per-page character cap. |

Single-URL fetches return one text block. Batch fetches return a short summary
block followed by one text block per URL.

## Client API

The root entry is edge-safe and uses configured API/hosted MCP providers only.
Use the `/node` entry when you want the full Node runtime with DuckDuckGo and
local page-fetch fallbacks.

```ts
import { createOpenSearch, fetch, search } from "@minpeter/opensearch";
import { fetch as nodeFetch } from "@minpeter/opensearch/node";

const results = await search("TypeScript 6 release notes", 5);
const first = results[0];

if (first) {
  const page = await nodeFetch(first.url);
  console.log(page.title, page.length);
}

const openSearch = createOpenSearch({
  env: {
    OPENSEARCH_ENABLE_EXA_MCP: "false",
    OPENSEARCH_SEARXNG_URLS: "https://searx.example",
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  },
});

const scopedResults = await openSearch.search("agent search APIs", 3);
const scopedPage = await openSearch.fetch("https://example.com/article", {
  maxCharacters: 12_000,
});
```

The module-level `search` and `fetch` functions read the Node process
environment. `createOpenSearch` uses only the `env` object you pass, which makes
it the better choice for libraries, tests, multi-tenant apps, and hosts that
manage configuration outside `process.env`.

`fetch(url)` returns one `FetchResult`. `fetch([urlA, urlB])` returns
`FetchResult[]`. `search(query, count)` returns `SearchResult[]`.

## AI SDK Tools

`opensearch-ai-sdk` exposes the same search and fetch runtime as AI SDK
tools named `web_search` and `web_fetch`. The root entry is edge-safe. Use
`/node` when you want DuckDuckGo search and local page-fetch fallbacks.

```ts
import { generateText } from "ai";
import { createOpenSearchTools } from "opensearch-ai-sdk";
import { createOpenSearchTools as createNodeOpenSearchTools } from "opensearch-ai-sdk/node";

const tools = createOpenSearchTools({
  openSearchOptions: {
    env: {
      OPENSEARCH_ENABLE_EXA_MCP: "false",
      OPENSEARCH_SEARXNG_URLS: "https://searx.example",
      TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    },
  },
});

const nodeTools = createNodeOpenSearchTools();

// Use the model instance already configured by your host application.
const answer = await generateText({
  model: hostAppModel,
  tools,
  prompt:
    "Search for current agent search API docs with web_search using numResults: 5, then fetch the most useful page with web_fetch.",
});
```

Pass `tools` or `nodeTools` to AI SDK calls that accept a tool set. The AI SDK
invokes `web_search` and `web_fetch` with its own execution options and returns
the model response with any tool results attached.

## Providers

The default route prefers configured high-quality providers, then hosted MCP
providers, then keyless public fallbacks. A provider failure does not stop the
search; the runtime continues to the next provider unless the failure is outside
the provider boundary.

Current search order:

1. TinyFish when `TINYFISH_API_KEY` is configured.
2. LLM-native APIs: Tavily, Firecrawl, Parallel API, You.com, Perplexity, Valyu,
   Linkup, and Jina.
3. SERP APIs: Serper, SerpAPI, DataForSEO, Google Custom Search, Bright Data,
   ScrapingBee, and SearchAPI.io.
4. Brave Search API.
5. Hosted MCP providers: Parallel Search MCP, then Exa MCP.
6. Exa Search API.
7. Independent providers: Kagi, Mojeek, and configured SearxNG instances.
8. Firecrawl no-key Search API.
9. DuckDuckGo public page fallback in the Node/full-runtime entry. Edge imports
   omit DuckDuckGo.

`web_fetch` tries Exa hosted MCP first, then TinyFish, Exa contents API,
Firecrawl no-key Scrape API, the local HTML/PDF extraction pipeline, and Jina
Reader for sparse content.

### No-key operation

The default install can search and fetch pages without user-supplied API keys
through hosted Parallel MCP, hosted Exa MCP, and Firecrawl's no-key Search and
Scrape APIs. The Node/full-runtime entry also adds DuckDuckGo as the final
public-page fallback. Public and hosted limits can change without notice, so use
API keys or a self-hosted SearxNG instance when you need predictable production
capacity.

Set these flags to remove fallback groups:

```sh
OPENSEARCH_ENABLE_PARALLEL_MCP=false
OPENSEARCH_ENABLE_EXA_MCP=false
OPENSEARCH_ENABLE_FIRECRAWL=false
```

### API key pools

Every routed API-key environment variable accepts one key or a
semicolon-delimited key pool:

```sh
TAVILY_API_KEY="tavily-key-1;tavily-key-2"
EXA_API_KEY="exa-key-1;exa-key-2"
```

Whitespace is trimmed and empty segments are ignored. On HTTP 429, the provider
tries the next key before normal fallback continues. Malformed payloads,
no-result responses, and non-rate-limit failures follow the fallback chain
without consuming another key.

Key pools are supported for:

`TINYFISH_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `PARALLEL_API_KEY`,
`YOU_API_KEY`, `PERPLEXITY_API_KEY`, `VALYU_API_KEY`, `LINKUP_API_KEY`,
`JINA_API_KEY`, `SERPER_API_KEY`, `SERPAPI_API_KEY`,
`GOOGLE_CUSTOM_SEARCH_API_KEY`, `BRIGHT_DATA_SERP_API_KEY`,
`SCRAPINGBEE_API_KEY`, `SEARCHAPI_API_KEY`, `KAGI_API_KEY`, `KAGI_API_TOKEN`,
`MOJEEK_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `EXA_API_KEY`.

`GOOGLE_CUSTOM_SEARCH_ENGINE_ID` is a single shared engine ID used with every
`GOOGLE_CUSTOM_SEARCH_API_KEY` entry. For DataForSEO, zip
`DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` as equal-length semicolon lists:

```sh
DATAFORSEO_LOGIN="login-a;login-b"
DATAFORSEO_PASSWORD="password-a;password-b"
```

Count mismatch errors include only environment names and counts, not credential
values.

### Provider configuration

| Provider | Environment |
|---|---|
| TinyFish | `TINYFISH_API_KEY` |
| Tavily | `TAVILY_API_KEY` |
| Firecrawl | optional `FIRECRAWL_API_KEY` for higher limits |
| Parallel API | `PARALLEL_API_KEY` |
| You.com | `YOU_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Valyu | `VALYU_API_KEY` |
| Linkup | `LINKUP_API_KEY` |
| Jina Search | `JINA_API_KEY` |
| Serper | `SERPER_API_KEY` |
| SerpAPI | `SERPAPI_API_KEY` |
| DataForSEO | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| Google Custom Search | `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` |
| Bright Data | `BRIGHT_DATA_SERP_API_KEY`, `BRIGHT_DATA_SERP_ZONE` |
| ScrapingBee | `SCRAPINGBEE_API_KEY` |
| SearchAPI.io | `SEARCHAPI_API_KEY` |
| Kagi | `KAGI_API_KEY` or `KAGI_API_TOKEN` |
| Mojeek | `MOJEEK_API_KEY` |
| Brave | `BRAVE_SEARCH_API_KEY` |
| Exa API | `EXA_API_KEY` |
| SearxNG | `OPENSEARCH_SEARXNG_URLS` |

Endpoint overrides are available for tests, private gateways, and enterprise
deployments:

`OPENSEARCH_TAVILY_URL`, `OPENSEARCH_FIRECRAWL_URL`,
`OPENSEARCH_PARALLEL_URL`, `OPENSEARCH_YOU_URL`,
`OPENSEARCH_PERPLEXITY_URL`, `OPENSEARCH_SERPER_URL`,
`OPENSEARCH_SERPAPI_URL`, `OPENSEARCH_DATAFORSEO_URL`,
`OPENSEARCH_GOOGLE_CSE_URL`, `OPENSEARCH_KAGI_URL`,
`OPENSEARCH_MOJEEK_URL`, `OPENSEARCH_BRIGHT_DATA_SERP_URL`,
`OPENSEARCH_SCRAPINGBEE_URL`, `OPENSEARCH_SEARCHAPI_URL`,
`OPENSEARCH_VALYU_URL`, `OPENSEARCH_LINKUP_URL`, and
`OPENSEARCH_JINA_SEARCH_URL`.

Credentialed endpoint overrides must use HTTPS. Plain HTTP is accepted only for
`localhost`, `127.0.0.1`, or `::1` test servers.

`OPENSEARCH_FIRECRAWL_URL` may point at a Firecrawl-compatible base URL such as
`https://api.firecrawl.dev/v2` or at an endpoint URL ending in `/search` or
`/scrape`; the runtime selects the matching endpoint for each operation.

Retired paths are intentionally ignored: `BING_SEARCH_API_KEY`,
`OPENSEARCH_BING_API_URL`, `OPENSEARCH_ENABLE_GOOGLE_SCRAPE`,
`NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, and `OPENSEARCH_NAVER_URL`.

## Development

```bash
pnpm install
pnpm run check
pnpm run typecheck
pnpm run test
pnpm run build
pnpm --filter opensearch-mcp start
```

## Provider metrics

Quantitative, side-by-side comparison of each provider's **limit** (fill-rate,
429/blocked, timeout, latency) and **search quality** (intrinsic heuristics,
cross-engine consensus, labeled golden queries).

```bash
# Deterministic, no network — runs as a gated test on every PR
pnpm --filter @minpeter/opensearch bench:offline -- --markdown /tmp/metrics.md

# Live — measures only the providers whose keys are present
pnpm --filter @minpeter/opensearch bench:live -- --out provider-metrics.json
```

- Metric definitions, formulas, and the composite score:
  [`packages/opensearch/src/bench/README.md`](packages/opensearch/src/bench/README.md)
- Per-provider limit/rate-limit contract:
  [`packages/opensearch/PROVIDERS.md`](packages/opensearch/PROVIDERS.md)
- The live monitor runs weekly via
  [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) and uploads a
  report artifact; the deterministic offline gate runs in `ci.yml`.

## Release

This repo publishes through Changesets.

```bash
pnpm changeset
```

After changes are merged to `main`, GitHub Actions opens or updates the release
PR. Merging the release PR publishes changed packages to npm.

## License

MIT

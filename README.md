# opensearch-mcp

Zero-config web search and fetch MCP with free-tier-first routing across official providers

## Tools

- **`web_search`** — Multi-engine web search with quality-first routing. It uses configured free-tier/API providers first, then falls back through Brave, hosted Parallel MCP, hosted Exa MCP, optional Exa API, optional Kagi/Mojeek/SearxNG, keyless public providers, DuckDuckGo, and an augmented Bing fallback. Responses are text-first and render the full result set in `content`.
- **`web_fetch`** — Fetches one or more URLs and converts them to markdown. It accepts Exa-style `urls`. Responses are text-first: each `content` block includes source metadata followed by extracted markdown. It tries Exa's hosted MCP fetch path first, then TinyFish when `TINYFISH_API_KEY` is configured, then Exa's official contents API when `EXA_API_KEY` is configured, then the local HTML/PDF pipeline and finally [Jina AI](https://jina.ai) for sparse content.

## Usage

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

Or with a specific version:

```json
{
  "mcpServers": {
    "opensearch": {
      "command": "npx",
      "args": ["-y", "opensearch-mcp@latest"]
    }
  }
}
```

## Library Usage

The reusable search and fetch runtime is published as `@minpeter/opensearch`.
The MCP package is a stdio wrapper around this library, so no-key routing,
free-tier-first provider order, fetch extraction, retry, and cache behavior live
in the library.

```ts
import { fetch, search } from "@minpeter/opensearch";

const results = await search("TypeScript release notes", 5);
const pages = await fetch(results.slice(0, 2).map((result) => result.url));
```

For library code that should not implicitly read `process.env`, create an
explicit client. Pass `process.env` when you want Node environment variables, or
pass a plain object when the host app owns configuration.

```ts
import { createOpenSearch } from "@minpeter/opensearch";

const openSearch = createOpenSearch({
  env: {
    OPENSEARCH_ENABLE_EXA_MCP: "false",
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  },
});

const results = await openSearch.search("TypeScript release notes", 5);
const firstResult = results[0];

if (firstResult) {
  const page = await openSearch.fetch(firstResult.url);
}
```

The MCP wrapper keeps using the module-level `search` and `fetch` exports so
existing environment-variable based setup remains zero-config.

## Tool Reference

### `web_search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Search query |
| `numResults` | number | 5 | Preferred max results to return (1–15) |
| `max_results` | number | 5 | Compatibility alias for `numResults` |

Returns an array of `{ engine, title, url, snippet }`. Result source names include `"TinyFish"`, `"Tavily"`, `"Firecrawl"`, `"Parallel"`, `"You"`, `"Perplexity"`, `"Serper"`, `"SerpAPI"`, `"DataForSEO"`, `"Kagi"`, `"Mojeek"`, `"SearxNG"`, `"BrightData"`, `"ScrapingBee"`, `"SearchAPI"`, `"Valyu"`, `"Linkup"`, `"Jina"`, `"Brave"`, `"Exa"`, `"Startpage"`, `"Webcrawler"`, `"Wikipedia"`, `"InternetArchive"`, `"Wiby"`, `"DuckDuckGo"`, `"Bing"`, and `"Google"`.

| Provider | Path used by this server | Credential needed here? | Notes |
|---|---|---:|---|
| TinyFish | TinyFish Search API | Yes | Requires `TINYFISH_API_KEY`; semicolon-delimited key pools are supported for HTTP 429 retry rotation. |
| Tavily | Tavily Search API | Yes | Requires `TAVILY_API_KEY`; semicolon-delimited key pools are tried in order. |
| Firecrawl | Firecrawl Search API | Yes | Requires `FIRECRAWL_API_KEY`. |
| Parallel | Parallel Search API | Yes | Requires `PARALLEL_API_KEY`; uses the current `/v1/search` endpoint and excerpt response shape. |
| Parallel | Parallel hosted MCP (`https://search.parallel.ai/mcp`) | No | Enabled by default unless `OPENSEARCH_ENABLE_PARALLEL_MCP=false`; if `PARALLEL_API_KEY` is present it is also sent as a Bearer token for higher limits. |
| You.com | You.com Search API | Yes | Requires `YOU_API_KEY`. |
| Perplexity | Perplexity Search API | Yes | Requires `PERPLEXITY_API_KEY`. |
| Serper | Google SERP API | Yes | Requires `SERPER_API_KEY`. |
| SerpAPI | Multi-engine SERP API | Yes | Requires `SERPAPI_API_KEY`. |
| DataForSEO | Google Organic SERP API | Yes | Requires `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`. |
| Google CSE | Google Custom Search JSON API | Yes | Requires `GOOGLE_CUSTOM_SEARCH_API_KEY` and `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`; available only to existing Custom Search JSON API customers. |
| Kagi | Kagi Search API | Yes | Requires `KAGI_API_KEY` or `KAGI_API_TOKEN`. |
| Mojeek | Mojeek Search API | Yes | Requires `MOJEEK_API_KEY`. |
| Bright Data | SERP API request endpoint | Yes | Requires `BRIGHT_DATA_SERP_API_KEY` and `BRIGHT_DATA_SERP_ZONE`; set `OPENSEARCH_BRIGHT_DATA_SERP_URL` only for a trusted custom gateway. |
| ScrapingBee | Google store SERP endpoint | Yes | Requires `SCRAPINGBEE_API_KEY`. |
| SearchAPI.io | SearchAPI Google SERP endpoint | Yes | Requires `SEARCHAPI_API_KEY`. |
| Valyu | Valyu Search API | Yes | Requires `VALYU_API_KEY`; uses `https://api.valyu.ai/v1/search`. |
| Linkup | Linkup Search API | Yes | Requires `LINKUP_API_KEY`. |
| Jina Search | Jina Search API (`https://s.jina.ai/<query>`) | Yes | Requires `JINA_API_KEY`; current Jina rate limits block unauthenticated search, while `web_fetch` still uses Jina Reader as a no-token sparse-content fallback. |
| Brave | Brave Search API | Yes | Requires `BRAVE_SEARCH_API_KEY`. |
| Exa | Exa hosted MCP (`https://mcp.exa.ai/mcp`) | No (free hosted plan) | Tried first unless `OPENSEARCH_ENABLE_EXA_MCP=false`. |
| Exa | Exa Search API | Yes | Used after hosted MCP when `EXA_API_KEY` is set. |
| SearxNG | JSON Search API | No | Set `OPENSEARCH_SEARXNG_URLS` to one or more public/self-hosted instances separated by semicolons. |
| Startpage | Public search page scraping | No | Keyless Google-proxy fallback; enabled by default unless `OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS=false`. |
| Webcrawler | Public metasearch page scraping | No | Keyless Google/Bing metasearch fallback. |
| Wikipedia | Public MediaWiki search API | No | Used only as a parallel supplement inside the augmented Bing fallback, not as a standalone general-search provider. |
| Internet Archive | Public Advanced Search API | No | Used only as a parallel supplement inside the augmented Bing fallback for historical/public collection matches. |
| Wiby | Public small-web search page scraping | No | Used only as a parallel supplement inside the augmented Bing fallback. |
| DuckDuckGo | HTML scraping | No | Public HTML endpoint; can still hit anti-bot challenges. |
| Bing | HTML scraping plus parallel supplements | No | Final keyless general fallback; fetches Bing, Wikipedia, Internet Archive, and Wiby in parallel, then returns Bing-first merged results. |

### API key pools

Every routed API-key environment variable accepts one key or a semicolon-delimited key pool:

```sh
TAVILY_API_KEY="tavily-key-1;tavily-key-2"
EXA_API_KEY="exa-key-1;exa-key-2"
```

Whitespace is trimmed and empty segments are ignored. For pooled providers, each request starts from the next configured key, and HTTP 429 responses retry the next key inside the same provider before normal fallback continues. Malformed payloads, no-result responses, and non-rate-limit failures do not consume the next key; they follow the existing provider fallback chain.

Search and fetch key pools are supported for `TINYFISH_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `PARALLEL_API_KEY`, `YOU_API_KEY`, `PERPLEXITY_API_KEY`, `VALYU_API_KEY`, `LINKUP_API_KEY`, `JINA_API_KEY`, `SERPER_API_KEY`, `SERPAPI_API_KEY`, `GOOGLE_CUSTOM_SEARCH_API_KEY`, `BRIGHT_DATA_SERP_API_KEY`, `SCRAPINGBEE_API_KEY`, `SEARCHAPI_API_KEY`, `KAGI_API_KEY`, `KAGI_API_TOKEN`, `MOJEEK_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `EXA_API_KEY`.

`GOOGLE_CUSTOM_SEARCH_ENGINE_ID` is a single shared engine id used with every `GOOGLE_CUSTOM_SEARCH_API_KEY` entry. `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` remain a single credential pair by default; multiple DataForSEO accounts require zipped semicolon lists with equal counts, for example `DATAFORSEO_LOGIN="login-a;login-b"` and `DATAFORSEO_PASSWORD="password-a;password-b"`. Count mismatch errors include env names and counts only, not credential values.

This project intentionally aggregates only official API paths, official hosted MCP paths, or public web pages. It does not rely on reverse-engineered private endpoints or credential bypasses.

#### Free coverage

Provider limits change, so treat this as a snapshot verified on 2026-06-07 and check the linked official pages before committing production capacity.

| Tier | Works without tokens? | Practical ceiling |
|---|---:|---|
| Default install | Yes | Hosted [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) and hosted [Exa MCP](https://exa.ai/docs/changelog/february-2026-api-updates) are enabled by default; Parallel supports anonymous lower-rate-limit MCP calls, and Exa unauthenticated MCP users get 150 calls/day at 3 QPS. Local `web_fetch` extraction also runs without a token. If upstream providers fail, `web_search` can still try Startpage, Webcrawler, DuckDuckGo, and augmented Bing. |
| SearxNG | Yes, with URL config | Add one or more public or self-hosted instances in `OPENSEARCH_SEARXNG_URLS`; no API key is sent. [SearxNG JSON output](https://docs.searxng.org/dev/search_api.html) must be enabled by the instance, and many public instances disable it or rate-limit it. |
| Zero-key public providers | Yes | Startpage and Webcrawler are standalone keyless providers. Wikipedia, Internet Archive, and Wiby are not standalone general-search fallbacks; they run in parallel only inside augmented Bing. Public HTML pages can change markup or rate-limit traffic, so these sit after hosted MCP/API-quality providers. |
| Parallel hosted MCP | Yes | [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) documents `https://search.parallel.ai/mcp` as free to use anonymously at lower rate limits; set `PARALLEL_API_KEY` only when you want higher limits. |
| Brave | Key required, monthly free credit | [Brave Search API](https://brave.com/search/api/) lists $5 in free monthly credits; Search is $5 per 1,000 requests. |
| Tavily | Key required, free monthly credits | [Tavily](https://docs.tavily.com/documentation/api-credits) lists 1,000 API credits/month with no credit card; basic search costs 1 credit. |
| Firecrawl | Key required, free monthly credits | [Firecrawl](https://www.firecrawl.dev/pricing) lists 1,000 credits/month; Search costs 2 credits per 10 results. |
| Serper | Key required, free starter queries | [Serper](https://serper.dev/) advertises 2,500 free queries with no credit card. |
| Google Custom Search JSON API | Key and engine ID required | [Google](https://developers.google.com/custom-search/v1/overview) lists 100 free queries/day for existing customers, but the API is closed to new customers and existing customers have until January 1, 2027 to transition. |
| SerpAPI | Key required, free monthly searches | [SerpAPI](https://serpapi.com/pricing) lists 250 searches/month on the free plan. |
| You.com | Key required, free credit | [You.com](https://about.you.com/pricing) lists $100 starting credit; Search is $5 per 1,000 calls. |
| Exa Search API | Key required, free monthly requests | [Exa](https://exa.ai/pricing?tab=api) lists 1,000 requests/month for free; Search is $7 per 1,000 requests after that. |
| DataForSEO | Account credentials required | [DataForSEO](https://dataforseo.com/apis/serp-api/pricing) lists $1 registration credit; pricing depends on retrieval mode and parameters. This server defaults to the live Google Organic endpoint, so check the current calculator before budgeting. |
| Parallel Search API | Key required, paid current listing | [Parallel](https://docs.parallel.ai/getting-started/pricing) lists the raw Search API at $5 per 1,000 requests; use hosted MCP for the no-key path. |
| Perplexity | Key required, paid current listing | [Perplexity](https://docs.perplexity.ai/getting-started/pricing) lists Search API at $5 per 1,000 requests; no always-free public API quota is documented there. |
| Jina Search | Key required, free API key quota | [Jina Reader API](https://jina.ai/en-US/reader/) currently lists `https://s.jina.ai` as blocked without an API key and 100 RPM with a free API key. |

Retired provider paths are intentionally not routed. `BING_SEARCH_API_KEY`, `OPENSEARCH_BING_API_URL`, `OPENSEARCH_ENABLE_GOOGLE_SCRAPE`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, and `OPENSEARCH_NAVER_URL` no longer add search providers.

The fallback chain is:

1. TinyFish when `TINYFISH_API_KEY` is configured.
2. LLM-native providers: Tavily, Firecrawl, Parallel API, You.com, Perplexity, Valyu, Linkup, Jina.
3. SERP/official providers: Serper, SerpAPI, DataForSEO, Google Custom Search, Bright Data, ScrapingBee, SearchAPI.io.
4. Brave Search API when configured.
5. Hosted MCP providers: Parallel, then Exa.
6. Exa Search API when configured.
7. Independent providers: Kagi, Mojeek, SearxNG.
8. Keyless public providers: Startpage, Webcrawler.
9. DuckDuckGo public page fallback.
10. Augmented Bing fallback: Bing, Wikipedia, Internet Archive, and Wiby run in parallel; results are deduped and returned Bing-first.

Set `OPENSEARCH_ENABLE_PARALLEL_MCP=false`, `OPENSEARCH_ENABLE_EXA_MCP=false`, or `OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS=false` to skip those fallback groups. If a configured provider returns malformed data, no results, auth failures, or rate limits, the server continues down the fallback chain instead of aborting the search.

Returns a compact text rendering of the full result set in `content`, with each result rendered in `Title` / `URL` / `Highlights` / `Source` form.

#### Optional endpoint overrides

Most API providers also support endpoint override environment variables for tests, private gateways, or enterprise-specific URLs:

`OPENSEARCH_TAVILY_URL`, `OPENSEARCH_FIRECRAWL_URL`, `OPENSEARCH_PARALLEL_URL`, `OPENSEARCH_YOU_URL`, `OPENSEARCH_PERPLEXITY_URL`, `OPENSEARCH_SERPER_URL`, `OPENSEARCH_SERPAPI_URL`, `OPENSEARCH_DATAFORSEO_URL`, `OPENSEARCH_GOOGLE_CSE_URL`, `OPENSEARCH_KAGI_URL`, `OPENSEARCH_MOJEEK_URL`, `OPENSEARCH_BRIGHT_DATA_SERP_URL`, `OPENSEARCH_SCRAPINGBEE_URL`, `OPENSEARCH_SEARCHAPI_URL`, `OPENSEARCH_VALYU_URL`, `OPENSEARCH_LINKUP_URL`, `OPENSEARCH_JINA_SEARCH_URL`, `OPENSEARCH_STARTPAGE_URL`, `OPENSEARCH_WEBCRAWLER_URL`, `OPENSEARCH_WIKIPEDIA_URL`, `OPENSEARCH_INTERNET_ARCHIVE_URL`, and `OPENSEARCH_WIBY_URL`.

Credentialed endpoint overrides must use HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1` test servers.

#### Reviewed but not routed

The zero-key audit also checked Dogpile, Info.com, ZapMeta, Search.com, Million Short, Teclis, Search Encrypt, Ghostery Private Search, Disconnect Search, Brave public HTML, Ecosia, Swisscows, MetaGer, Qwant, Marginalia, Whoogle/LibreX public instances, Yandex, Baidu, Yahoo, Ask.com, Yippy, Gigablast, Common Crawl, and Naver scrape candidates. They are not routed by default because the live public paths were blocked by captcha/login flows, closed beta pages, dead endpoints, unstable redirects, non-real-time index semantics, or markup that did not expose reliable result records during verification. Naver is intentionally excluded.

### `web_fetch`

| Parameter | Type | Description |
|-----------|------|-------------|
| `urls` | string[] | URLs to fetch in one call |

For non-disabled hosted MCP mode, `web_fetch` tries Exa's official hosted MCP fetch path first so it can use the hosted free tier. If that is unavailable and `TINYFISH_API_KEY` is configured, it falls back to TinyFish's fetch API before trying Exa's official `POST /contents` API, the local Readability/PDF pipeline, and Jina for sparse content. `TINYFISH_API_KEY` and `EXA_API_KEY` may contain a single key or a semicolon-delimited key pool; HTTP 429 responses rotate to the next configured key before falling back.

Single-fetch calls return one text block in `content` with `Title`, `URL`, `Length`, and the extracted markdown. Batch-fetch calls return a short summary block plus one text block per fetched URL with the same metadata-first format.

## Development

```bash
pnpm install
pnpm run build
pnpm run test
pnpm --filter opensearch-mcp start
```

### Release (via Changesets)

1. Make changes and add a changeset:
   ```bash
   pnpm changeset
   ```

2. Push to `main` — GitHub Actions will open a "Release PR" automatically.

3. Merge the Release PR → package is published to npm.

## License

MIT

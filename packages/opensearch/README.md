# @minpeter/opensearch

Reusable web search and page fetch runtime for TypeScript clients.

```ts
import { search, fetch } from "@minpeter/opensearch";
const results = await search("node release", 5);
const pages = await fetch(["https://nodejs.org"]);
```

Use the root entrypoint for edge-compatible API-backed search and fetch. Use the
Node entrypoint when you want local scraping, DuckDuckGo fallback, media metadata,
or other Node-only fetch behavior:

```ts
import { createOpenSearch } from "@minpeter/opensearch/node";
```

The TLS impersonation fallback installs with the package through `wreq-js`.
Playwright is intentionally only an optional peer because it is a heavier runtime:

```sh
pnpm add playwright
```

Then opt in with `OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK=true`.

## License

MIT

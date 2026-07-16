# @minpeter/opensearch

Reusable web search and page fetch runtime for TypeScript clients.

```ts
import { search, fetch } from "@minpeter/opensearch";
const results = await search("node release", 5);
const pages = await fetch(["https://nodejs.org"]);
```

Page content is capped at 12,000 extracted characters by default, consistently
across every provider and fallback. Set a positive integer limit when a
different context budget is needed:

```ts
const page = await fetch("https://nodejs.org", { maxCharacters: 4_000 });
```

Batch fetches deduplicate repeated URLs and start at most eight per-URL provider
operations at once by default. Configure a client-wide limit, or override it for
one call:

```ts
import { createOpenSearch } from "@minpeter/opensearch";

const client = createOpenSearch({ fetch: { maxConcurrency: 4 } });
const pages = await client.fetch(
  ["https://nodejs.org", "https://www.typescriptlang.org"],
  { maxConcurrency: 2 },
);
```

The limit applies to per-URL work such as public API, Firecrawl, and local
fallbacks. A provider's native batch endpoint remains one scheduled operation.
Code that intentionally relied on the previous all-at-once behavior can set
`maxConcurrency` to its known batch size.

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

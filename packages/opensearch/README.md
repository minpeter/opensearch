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

## Per-client cache and network policy

Search and fetch caches are isolated per client, retain at most 256 resolved
entries, and expire entries after three minutes by default. They can be sized,
retimed, or disabled independently:

```ts
const client = createOpenSearch({
  fetch: { cache: { maxEntries: 128, ttlMs: 60_000 } },
  search: { cache: { enabled: false } },
});
```

Every entrypoint rejects non-HTTP(S) URLs and URL userinfo before any hosted
provider receives them. The Node entrypoint additionally rejects loopback,
private, link-local, metadata, and internal destinations before any public API
or provider route runs. Its local downloader also revalidates redirects and
resolved addresses, follows at most five redirects, and retains at most 10 MiB
per response:

```ts
import { createOpenSearch } from "@minpeter/opensearch/node";

const client = createOpenSearch({
  fetch: { maxDownloadBytes: 5 * 1024 * 1024, maxRedirects: 3 },
});
```

Set `allowPrivateNetwork: true` only for an intentional intranet or local-agent
deployment. In a multi-tenant service, keep the default and add an outbound
network firewall as a second boundary.

## Observability

`createOpenSearch` accepts an edge-safe event sink for operation, cache,
provider, fallback, failure, and latency metrics. Raw queries and URLs are
omitted from events by default. A sink is fire-and-forget: a thrown error or
rejected promise never changes the search or fetch result.

```ts
import type { OpenSearchEvent } from "@minpeter/opensearch";

const client = createOpenSearch({
  observability: {
    onEvent(event: OpenSearchEvent) {
      metrics.write(event);
    },
  },
});
```

Every event has an `operationId`, `timestampMs`, and `operation`. Provider and
operation completion events include a `durationMs` latency measurement; cache
events report `hit`, `miss`, or `bypass`.

## Ollama web tools

Ollama search and fetch are opt-in:

```sh
export OPENSEARCH_ENABLE_OLLAMA=true
```

The Node entrypoint first uses a signed-in local daemon (`ollama serve` and
`ollama signin`) and then `OLLAMA_API_KEY` for the cloud endpoint when the local
daemon is unavailable or unsigned. Set `OLLAMA_HOST` to change the daemon origin
or `OPENSEARCH_DISABLE_OLLAMA_LOCAL=true` to force cloud-only use. The edge
entrypoint is always cloud-only. Local and cloud paths share one account quota,
so a local HTTP 429 is not retried against cloud and the provider chain moves to
a different engine instead.

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

## Operational limits

- Caches are in-process and per client; they are not a distributed cache or a
  cross-instance concurrency limit.
- Direct Node downloads use connection-time DNS filtering. Optional native TLS
  and browser fallbacks validate URLs and redirects, but their native resolvers
  cannot be pinned by this package; high-risk deployments should enforce egress
  policy outside the process too.
- Playwright validates the serialized HTML size, but the browser may allocate
  resources while rendering before that final size check. Keep it disabled
  unless JavaScript rendering is required.
- Hosted fetch providers receive the requested URL and apply their own network,
  billing, quota, and retention policies.
- HTTP 451 responses are terminal and are never routed around through another
  provider; ordinary availability and rate-limit failures can still fall back.

See [`src/bench/README.md`](./src/bench/README.md) for deterministic metrics,
live health gates, persisted baselines, charts, and reproduction commands. The
cache, network, and bundle before/after measurements are recorded in
[`RUNTIME_HARDENING.md`](./src/bench/RUNTIME_HARDENING.md).

## License

MIT

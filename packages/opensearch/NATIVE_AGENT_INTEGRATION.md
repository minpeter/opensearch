# Native coding-agent search

OpenSearch can prepend search routes owned by a coding agent to its existing
API, MCP, scraping, and keyless providers. This is the integration point for
PSS or another agent that already owns model subscriptions and session
credentials.

## Who makes each decision

Keep provider selection out of the model-facing tool schema:

1. The agent decides **whether to search** and supplies the query.
2. The PSS host decides whether the active model supports a provider-native
   server tool. OpenAI Responses and Anthropic Messages search belong here
   because they execute inside the active model request.
3. For callable subscription routes such as a Kimi search endpoint, the host
   registry reports the active route and other available routes to OpenSearch.
4. OpenSearch tries the active route, unique discovered routes, configured API
   providers, and finally public fallbacks in deterministic order.

This keeps the `web_search` tool portable and prevents an LLM from selecting a
provider based on secrets, billing configuration, or transient availability.

## PSS registry bridge

Use the library in the PSS process. A registry snapshot is resolved for every
uncached search, so signing in, signing out, or changing the active model does
not require rebuilding the client.

```ts
import {
  createOpenSearch,
  type NativeSearchRegistry,
  type NativeSearchRoute,
  SearchEngineError,
} from "@minpeter/opensearch/node";

const nativeRegistry: NativeSearchRegistry = {
  async resolve() {
    const activeModel = pss.modelRegistry.getActive();
    const availableModels = pss.modelRegistry.getAvailable();

    return {
      active: activeModel
        ? await createPssSearchRoute(activeModel)
        : undefined,
      available: (
        await Promise.all(availableModels.map(createPssSearchRoute))
      ).filter((route): route is NativeSearchRoute => route !== undefined),
    };
  },
};

const openSearch = createOpenSearch({
  search: { nativeRegistry },
});

pss.tools.register({
  name: "web_search",
  inputSchema: {
    query: "string",
    numResults: "number?",
  },
  execute: ({ query, numResults }) =>
    openSearch.search(query, numResults, { cache: "bypass" }),
});

async function createPssSearchRoute(
  model: PssModel
): Promise<NativeSearchRoute | undefined> {
  const adapter = pss.nativeSearch.adapterFor(model);
  if (!adapter) {
    return;
  }

  return {
    // Use a normalized provider endpoint or host route id. Never use a token.
    id: adapter.routeId,
    engine: adapter.engine,
    async search(query, numResults, options) {
      try {
        const response = await adapter.search({
          numResults,
          query,
          signal: options.signal,
        });
        return response.results.map((result) => ({
          snippet: result.snippet,
          title: result.title,
          url: result.url,
        }));
      } catch (error) {
        throw classifyPssSearchError(adapter.engine, error);
      }
    },
  };
}

function classifyPssSearchError(
  engine: NativeSearchRoute["engine"],
  error: unknown
): SearchEngineError {
  if (pss.errors.isRateLimit(error) || pss.errors.isServerError(error)) {
    return new SearchEngineError(engine, "transient", "provider unavailable");
  }
  if (pss.errors.isUnauthorized(error)) {
    return new SearchEngineError(engine, "misconfigured", "session unavailable");
  }
  if (pss.errors.isBlocked(error)) {
    return new SearchEngineError(engine, "blocked", "request blocked", {
      status: 451,
    });
  }
  throw error;
}
```

The `pss` names above are integration placeholders. Adapt them to the PSS model
registry and native provider clients; the OpenSearch interfaces and error kinds
are the shipped contract.

## Route contract

- `active` is attempted first.
- `available` preserves host order.
- Duplicate `id` values are removed, including an active route repeated in
  `available`.
- `id` must be stable and non-secret. A normalized provider plus endpoint is a
  good identity; an API key, OAuth token, account id, or hash of a credential is
  not.
- Route functions return `{ title, url, snippet }`. OpenSearch attaches and
  validates the declared engine before exposing a `SearchResult`. An empty
  array becomes a `no-results` failure so the next provider can run.
- A route attempt is bounded to eight seconds by default. Set `timeoutMs` on
  the route when its provider has a stricter deadline, and pass the supplied
  abort signal into the host request.
- A `SearchEngineError` participates in normal fallback. HTTP 451 remains
  terminal. Unknown errors stop immediately, which prevents invalid host input
  and programming errors from being hidden by another provider.
- If every provider fails transiently, the existing bounded search retry policy
  applies. Mixed or non-transient failures are not retried as a group.
- A registry may throw a sanitized `SearchEngineError` when subscription
  discovery itself fails. OpenSearch records that classified provider failure
  and continues to its existing providers. Unknown registry errors remain
  terminal so host programming errors are not hidden.

Keep credentials and provider-specific headers captured inside `search`. Do not
return them from `resolve`, place them in route ids, include them in errors, or
write them to observability events.

## MCP boundary

An external MCP process cannot see subscription state held only in the PSS
process. It should not scrape PSS, Claude, Codex, or Senpi credential files.

Use `opensearch-mcp` unchanged when public fallback or environment API keys are
enough. When PSS subscriptions must join the route, register the in-process
library tool shown above. If PSS requires an MCP boundary for all tools, host an
authenticated PSS-owned proxy that exposes search operations without exposing
credentials, then wrap that proxy in a `NativeSearchRoute` inside the same trust
boundary.

For OpenAI or Anthropic provider-native search, prefer adding their server-side
search tool to the active model request. Calling those providers again from MCP
duplicates the model request, can lose subscription headers, and changes usage
and billing semantics.

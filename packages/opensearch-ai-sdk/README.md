# opensearch-ai-sdk

Vercel AI SDK tools for OpenSearch code search, web search, and page fetch.

```ts
import { generateText } from "ai";
import { createOpenSearchTools } from "opensearch-ai-sdk";
const tools = createOpenSearchTools(); // code_search, web_search, web_fetch
const { text } = await generateText({ model, prompt: "What's new in Node 22?", tools });
```

The root entrypoint uses the edge-compatible `@minpeter/opensearch` runtime.
Import the Node entrypoint when your app should use the Node-only OpenSearch
runtime:

```ts
import { createOpenSearchTools } from "opensearch-ai-sdk/node";
```

Core policies remain constructor options rather than tool-schema fields, so
models cannot override infrastructure limits:

```ts
const tools = createOpenSearchTools({
  openSearchOptions: {
    codeSearch: { githubToken: process.env.GITHUB_TOKEN },
    fetch: { maxConcurrency: 4 },
    observability: { onEvent: (event) => telemetry.write(event) },
  },
});
```

Install `@minpeter/opensearch`'s optional Playwright peer only if you enable its
Playwright fallback.

## License

MIT

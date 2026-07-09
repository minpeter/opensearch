# opensearch-ai-sdk

Vercel AI SDK tools for OpenSearch web search and page fetch.

```ts
import { generateText } from "ai";
import { createOpenSearchTools } from "opensearch-ai-sdk";
const tools = createOpenSearchTools();
const { text } = await generateText({ model, prompt: "What's new in Node 22?", tools });
```

The root entrypoint uses the edge-compatible `@minpeter/opensearch` runtime.
Import the Node entrypoint when your app should use the Node-only OpenSearch
runtime:

```ts
import { createOpenSearchTools } from "opensearch-ai-sdk/node";
```

Install `@minpeter/opensearch`'s optional Playwright peer only if you enable its
Playwright fallback.

## License

MIT

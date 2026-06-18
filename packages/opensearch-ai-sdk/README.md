# opensearch-ai-sdk

Vercel AI SDK tools for OpenSearch web search and page fetch.

```ts
import { generateText } from "ai";
import { createOpenSearchTools } from "opensearch-ai-sdk";
const tools = createOpenSearchTools();
const { text } = await generateText({ model, prompt: "What's new in Node 22?", tools });
```

## License

MIT

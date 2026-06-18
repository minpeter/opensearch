# @minpeter/opensearch

Reusable web search and page fetch runtime for TypeScript clients.

```ts
import { search, fetch } from "@minpeter/opensearch";
const results = await search("node release", 5);
const pages = await fetch(["https://nodejs.org"]);
```

## License

MIT

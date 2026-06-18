# opensearch

Web search and page fetch for agents and TypeScript apps — one runtime, three packages.

## Packages

- `@minpeter/opensearch` is the core TypeScript runtime for provider routing,
  search, and clean page extraction. Read more in
  [packages/opensearch/README.md](packages/opensearch/README.md).
- `opensearch-mcp` exposes the runtime as zero-config `web_search` and
  `web_fetch` MCP stdio tools. Read more in
  [packages/opensearch-mcp/README.md](packages/opensearch-mcp/README.md).
- `opensearch-ai-sdk` exposes the same search and fetch surface as Vercel AI SDK
  tools. Read more in
  [packages/opensearch-ai-sdk/README.md](packages/opensearch-ai-sdk/README.md).

## Special Thanks

Thanks to [fivetaku/insane-search](https://github.com/fivetaku/insane-search)
for the search and fetch fallback ideas that helped shape this work.
감사합니다. Xie xie.

## License

MIT

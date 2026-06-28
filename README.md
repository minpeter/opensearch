<p align="center">
  <img src="assets/banner.png" alt="opensearch banner" width="100%" />
</p>

# opensearch

Web search and page fetch for agents and TypeScript apps.

## Packages

[`@minpeter/opensearch`](packages/opensearch/README.md) is the core runtime for
search, fetch, routing, and page extraction.

[`opensearch-mcp`](packages/opensearch-mcp/README.md) ships `web_search` and
`web_fetch` as MCP stdio tools.

[`opensearch-ai-sdk`](packages/opensearch-ai-sdk/README.md) wraps the same
search and fetch surface for the Vercel AI SDK.

## Release Notes

This repository uses Tegami for package versioning and publishing. Changes that
affect published packages should include a `.tegami/*.md` changelog file before
merge.

```md
---
packages:
  "npm:@minpeter/opensearch": patch
---

## Add provider fallback

Describe the user-visible package change.
```

Use package ids `npm:@minpeter/opensearch`, `npm:opensearch-ai-sdk`, and
`npm:opensearch-mcp`. Run `pnpm tegami` to create a changelog interactively.

## Special Thanks

Thanks to [fivetaku/insane-search](https://github.com/fivetaku/insane-search)
for the fetch fallback and anti-bot research that informed this project.

## License

MIT

# opensearch-mcp

Zero-config `code_search`, `web_search`, and `web_fetch` for any MCP client.

```json
{
  "mcpServers": {
    "opensearch": { "command": "npx", "args": ["-y", "opensearch-mcp"] }
  }
}
```

The CLI runs the Node OpenSearch runtime. It works without API keys through the
available public fallbacks, and can use provider credentials from the same
environment variables as `@minpeter/opensearch`.

`code_search` fans out across grep.app, Exa Code, and Sourcegraph without keys.
At startup the CLI prefers `GITHUB_TOKEN` or `GH_TOKEN`; when neither exists it
runs `gh auth token` silently and passes the result directly to the core client,
so an authenticated GitHub CLI enables native GitHub code search automatically.
The token is never written to logs or copied into `process.env`.

Set `OPENSEARCH_MCP_LOG_EVENTS=true` to write sanitized core lifecycle events as
one JSON object per stderr line. Events include operation/provider/cache/fallback
state and latency but omit raw queries and URLs, so container log collectors can
build basic availability and latency dashboards without parsing tool output.

Playwright is not installed automatically. If you want the optional Playwright
fallback, install it alongside the MCP package and set
`OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK=true`.

## License

MIT

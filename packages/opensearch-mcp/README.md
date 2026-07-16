# opensearch-mcp

Zero-config `web_search` and `web_fetch` for any MCP client.

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

Set `OPENSEARCH_MCP_LOG_EVENTS=true` to write sanitized core lifecycle events as
one JSON object per stderr line. Events include operation/provider/cache/fallback
state and latency but omit raw queries and URLs, so container log collectors can
build basic availability and latency dashboards without parsing tool output.

Playwright is not installed automatically. If you want the optional Playwright
fallback, install it alongside the MCP package and set
`OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK=true`.

## License

MIT

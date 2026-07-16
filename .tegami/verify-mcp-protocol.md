---
packages:
  npm:opensearch-mcp:
    type: patch
---

## Verify the installed MCP protocol

Exercise the packaged MCP executable through `initialize` and `tools/list`
during tarball and registry verification. Reject stale bundles whose runtime
version differs from the package manifest, and require both `web_search` and
`web_fetch` to be discoverable before package QA or the release workflow
completes.

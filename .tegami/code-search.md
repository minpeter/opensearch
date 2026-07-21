---
packages:
  npm:@minpeter/opensearch:
    type: patch
  npm:opensearch-mcp:
    type: patch
  npm:opensearch-ai-sdk:
    type: patch
---

### Add multi-provider code search

- Add `codeSearch` to the core client and both entrypoints, with parallel
  providers for grep.app MCP, Exa Code Context, Sourcegraph GraphQL, and
  GitHub's native code search API.
- Return AI-friendly file-grouped results with repository, path, URL,
  provider, line ranges, and snippets; round-robin providers before the result
  cap, deduplicate files, cache repeated calls, and tolerate partial provider
  failure.
- Add `code_search` to the MCP and Vercel AI SDK surfaces with repository,
  path, language, regexp, provider, and result-count filters.
- The MCP server now detects `GITHUB_TOKEN` / `GH_TOKEN`, then falls back to
  `gh auth token` without logging or mutating the environment, so signed-in GitHub
  CLI users receive native GitHub code search automatically.

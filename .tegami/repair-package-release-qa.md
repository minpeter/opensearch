---
packages:
  "npm:@minpeter/opensearch": patch
  "npm:opensearch-ai-sdk": patch
  "npm:opensearch-mcp": patch
---

## Repair package installation and release verification

Publish adapter dependencies as real semver ranges instead of workspace
protocols. Add clean tarball installation and entrypoint smoke tests, verify
registry packages only on actual publish runs, and update release, dependency,
security, coverage, and Node 22/24 CI gates.

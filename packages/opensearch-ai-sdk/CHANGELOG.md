## opensearch-ai-sdk@0.0.5

### Enforce page content limits across every fetch path

Apply the requested `maxCharacters` limit, or the documented 12,000-character
default, after every fetch provider and fallback. This keeps core, AI SDK, and
MCP results within the same output budget even when an upstream provider ignores
the requested limit, and rejects invalid limits instead of forwarding them.

# opensearch-ai-sdk

## 0.0.3

### Patch Changes

- Updated dependencies [900a772]
  - @minpeter/opensearch@0.0.4

## 0.0.2

### Patch Changes

- 3e25c40: docs: add minimal READMEs to all packages, slim root README
- Updated dependencies [3e25c40]
  - @minpeter/opensearch@0.0.3

## 0.0.1

### Patch Changes

- e6158e2: Add the OpenSearch AI SDK tools package scaffold.
- Updated dependencies [6e19a13]
  - @minpeter/opensearch@0.0.2

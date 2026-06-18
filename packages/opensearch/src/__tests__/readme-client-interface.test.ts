import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readme = readFileSync(
  new URL("../../../../README.md", import.meta.url),
  "utf8"
);
const rootPackageJson = readFileSync(
  new URL("../../../../package.json", import.meta.url),
  "utf8"
);
const libraryPackageJson = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8"
);
const mcpPackageJson = readFileSync(
  new URL("../../../opensearch-mcp/package.json", import.meta.url),
  "utf8"
);
const aiSdkPackageJson = readFileSync(
  new URL("../../../opensearch-ai-sdk/package.json", import.meta.url),
  "utf8"
);

describe("README client interface", () => {
  it("leads with install, MCP setup, and the public client API", () => {
    const installIndex = readme.indexOf("## Install");
    const mcpIndex = readme.indexOf("## MCP Server");
    const clientIndex = readme.indexOf("## Client API");
    const aiSdkToolsIndex = readme.indexOf("## AI SDK Tools");
    const providerIndex = readme.indexOf("## Providers");

    expect(installIndex).toBeGreaterThan(0);
    expect(mcpIndex).toBeGreaterThan(installIndex);
    expect(clientIndex).toBeGreaterThan(mcpIndex);
    expect(aiSdkToolsIndex).toBeGreaterThan(clientIndex);
    expect(providerIndex).toBeGreaterThan(aiSdkToolsIndex);
  });

  it("documents only the stable library entry points in examples", () => {
    expect(readme).toContain(
      'import { createOpenSearch, fetch, search } from "@minpeter/opensearch";'
    );
    expect(readme).toContain(
      'import { fetch as nodeFetch } from "@minpeter/opensearch/node";'
    );
    expect(readme).toContain("root entry is edge-safe");
    expect(readme).toContain("Use the `/node` entry");
    expect(readme).toContain("const openSearch = createOpenSearch({");
    expect(readme).toContain("await search(");
    expect(readme).toContain("await nodeFetch(");

    expect(readme).not.toContain("fetchUrlsWithCache");
    expect(readme).not.toContain("searchWithRetryAndCache");
    expect(readme).not.toContain("searchOnce");
  });

  it("documents the MCP fetch defaults that clients actually see", () => {
    expect(readme).toContain("| `maxCharacters` | number | `12_000` |");
  });

  it("documents the AI SDK tools package surface", () => {
    expect(readme).toContain("pnpm add opensearch-ai-sdk ai");
    expect(readme).toContain('import { generateText } from "ai";');
    expect(readme).toContain(
      'import { createOpenSearchTools } from "opensearch-ai-sdk";'
    );
    expect(readme).toContain(
      'import { createOpenSearchTools as createNodeOpenSearchTools } from "opensearch-ai-sdk/node";'
    );
    expect(readme).toContain("const tools = createOpenSearchTools({");
    expect(readme).toContain("  openSearchOptions: {");
    expect(readme).toContain("    env: {");
    expect(readme).toContain("const nodeTools = createNodeOpenSearchTools();");
    expect(readme).toContain("await generateText({");
    expect(readme).toContain("  tools,");
    expect(readme).toContain("`web_search` and `web_fetch`");
    expect(readme).toContain("numResults: 5");

    expect(readme).not.toContain("@minpeter/opensearch-ai-sdk");
    expect(readme).not.toContain("createOpenSearchTools({\n  env:");
    expect(readme).not.toContain("  max_results: 5,");
    expect(readme).not.toContain("tools.web_search.execute(");
    expect(readme).not.toContain("tools.web_fetch.execute(");
    expect(readme).not.toContain("contextSchema");
    expect(readme).not.toContain("toolsContext");
  });

  it("keeps README prose direct instead of generated-feature-list copy", () => {
    expect(readme).not.toContain("Best for:");
    expect(readme).not.toContain("Query tips:");
    expect(readme).not.toContain("Reviewed but not routed");
    expect(readme).not.toContain("Reviewed but not routed candidates");
  });

  it("keeps package descriptions aligned with the polished client interface", () => {
    expect(rootPackageJson).toContain(
      '"description": "Zero-config web search and page fetch for MCP clients"'
    );
    expect(libraryPackageJson).toContain(
      '"description": "Reusable web search and page fetch runtime for TypeScript clients"'
    );
    expect(mcpPackageJson).toContain(
      '"description": "Zero-config web search and page fetch MCP backed by @minpeter/opensearch"'
    );
    expect(aiSdkPackageJson).toContain('"name": "opensearch-ai-sdk"');
    expect(aiSdkPackageJson).toContain(
      '"description": "AI SDK tools for OpenSearch web search and page fetch"'
    );
  });
});

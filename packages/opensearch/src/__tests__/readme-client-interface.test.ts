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
  it("keeps the README concise and package-focused", () => {
    expect(readme).toContain("# opensearch");
    expect(readme).toContain(
      "Web search and page fetch for agents and TypeScript apps"
    );
    expect(readme).toContain("@minpeter/opensearch");
    expect(readme).toContain("opensearch-mcp");
    expect(readme).toContain("opensearch-ai-sdk");
    expect(readme).toContain("## License");
  });

  it("does not document internal helper entry points or telemetry fields", () => {
    expect(readme).not.toContain("fetchUrlsWithCache");
    expect(readme).not.toContain("searchWithRetryAndCache");
    expect(readme).not.toContain("searchOnce");
    expect(readme).not.toContain("profileUsed");
    expect(readme).not.toContain("sidecars");
    expect(readme).not.toContain("verdict");
  });

  it("keeps README prose direct instead of generated-feature-list copy", () => {
    expect(readme).not.toContain("Best for:");
    expect(readme).not.toContain("Query tips:");
    expect(readme).not.toContain("Reviewed but not routed");
    expect(readme).not.toContain("Reviewed but not routed candidates");
  });

  it("keeps package descriptions aligned with the client interface", () => {
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

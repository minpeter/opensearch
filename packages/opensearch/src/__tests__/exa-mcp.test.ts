import { describe, expect, it } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { createExaMcpRequestUrl } from "../providers/exa-mcp/client.ts";

describe("createExaMcpRequestUrl", () => {
  it("rejects remote HTTP endpoint overrides", () => {
    const env = createEnvironmentReader({
      OPENSEARCH_EXA_MCP_URL: "http://evil.example/mcp",
    });

    expect(() => createExaMcpRequestUrl(["web_search_exa"], env)).toThrow(
      "OPENSEARCH_EXA_MCP_URL must be an HTTPS URL or a localhost URL for local testing"
    );
  });

  it("allows localhost endpoint overrides for private test gateways", () => {
    const env = createEnvironmentReader({
      OPENSEARCH_EXA_MCP_URL: "http://127.0.0.1:4111/mcp",
    });
    const url = new URL(createExaMcpRequestUrl(["web_fetch_exa"], env));

    expect(`${url.origin}${url.pathname}`).toBe("http://127.0.0.1:4111/mcp");
    expect(url.searchParams.get("tools")).toBe("web_fetch_exa");
  });
});

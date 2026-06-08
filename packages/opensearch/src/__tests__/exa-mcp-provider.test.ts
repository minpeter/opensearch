import { describe, expect, it } from "vitest";

import {
  createExaMcpServerUrl,
  DEFAULT_EXA_MCP_SERVER_URL,
  parseExaMcpContentItems,
  parseExaMcpFetchContentItem,
  parseExaMcpFetchContentItems,
  parseExaMcpFetchText,
  parseExaMcpSearchToolText,
} from "../providers/exa-mcp/content.ts";

describe("createExaMcpServerUrl", () => {
  it("targets the hosted Exa MCP endpoint with only the requested tools", () => {
    const url = new URL(
      createExaMcpServerUrl(DEFAULT_EXA_MCP_SERVER_URL, [
        " web_search_exa ",
        "web_fetch_exa",
        "web_search_exa",
      ])
    );

    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_EXA_MCP_SERVER_URL);
    expect(url.searchParams.get("tools")).toBe("web_search_exa,web_fetch_exa");
  });

  it("drops the tools query parameter when no tool filter is requested", () => {
    const url = new URL(createExaMcpServerUrl(DEFAULT_EXA_MCP_SERVER_URL, []));

    expect(url.searchParams.has("tools")).toBe(false);
  });

  it("rejects non-local HTTP endpoint overrides", () => {
    expect(() =>
      createExaMcpServerUrl("http://evil.example/mcp", ["web_search_exa"])
    ).toThrow("OPENSEARCH_EXA_MCP_URL must be an HTTPS URL");
  });

  it("allows localhost HTTP endpoint overrides", () => {
    const url = new URL(
      createExaMcpServerUrl("http://127.0.0.1:43111/mcp", ["web_search_exa"])
    );

    expect(`${url.origin}${url.pathname}`).toBe("http://127.0.0.1:43111/mcp");
    expect(url.searchParams.get("tools")).toBe("web_search_exa");
  });
});

describe("parseExaMcpFetchText", () => {
  it("extracts title, url, and markdown body from web_fetch_exa text", () => {
    const result =
      parseExaMcpFetchText(`# GitHub · Change is constant. GitHub keeps you ahead. · GitHub
URL: https://github.com/
Published: 2025-05-30

GitHub · Change is constant. GitHub keeps you ahead. · GitHub

## The future of building happens together`);

    expect(result).toEqual({
      content: `GitHub · Change is constant. GitHub keeps you ahead. · GitHub

## The future of building happens together`,
      title: "GitHub · Change is constant. GitHub keeps you ahead. · GitHub",
      url: "https://github.com/",
    });
  });

  it("returns null for malformed web_fetch_exa text", () => {
    expect(parseExaMcpFetchText("missing metadata")).toBeNull();
  });
});

describe("parseExaMcpFetchContentItem", () => {
  it("reads the first text content item for web_fetch_exa", () => {
    const result = parseExaMcpFetchContentItem([
      { type: "resource", text: "ignore me" },
      {
        type: "text",
        text: `# Example
URL: https://example.com/page

Body text.`,
      },
    ]);

    expect(result).toEqual({
      content: "Body text.",
      title: "Example",
      url: "https://example.com/page",
    });
  });
});

describe("parseExaMcpFetchContentItems", () => {
  it("parses multiple fetch blocks from text content items", () => {
    const results = parseExaMcpFetchContentItems([
      {
        type: "text",
        text: `# First
URL: https://example.com/first

First body.`,
      },
      {
        type: "text",
        text: `# Second
URL: https://example.com/second

Second body.`,
      },
    ]);

    expect(results).toEqual([
      {
        content: "First body.",
        title: "First",
        url: "https://example.com/first",
      },
      {
        content: "Second body.",
        title: "Second",
        url: "https://example.com/second",
      },
    ]);
  });
});

describe("parseExaMcpSearchToolText", () => {
  it("parses hosted MCP web_search_exa highlight blocks into search results", () => {
    const results = parseExaMcpSearchToolText(`
Title: GitHub
URL: https://github.com/
Published: 2026-04-01T00:00:00.000Z
Author: Exa
Highlights:
GitHub is where people build software.
Collaborate, ship, and review code.
    `);

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "GitHub is where people build software.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
  });

  it("falls back to Text when highlights are unavailable", () => {
    const results = parseExaMcpSearchToolText(`
Title: Exa MCP Server
URL: https://github.com/exa-labs/exa-mcp-server
Published: N/A
Author: N/A
Text: Connect AI assistants to Exa's search capabilities with the hosted MCP server.
    `);

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet:
          "Connect AI assistants to Exa's search capabilities with the hosted MCP server.",
        title: "Exa MCP Server",
        url: "https://github.com/exa-labs/exa-mcp-server",
      },
    ]);
  });

  it("parses multiple result blocks and ignores malformed entries", () => {
    const results = parseExaMcpSearchToolText(`
Title: First result
URL: https://example.com/first
Highlights:
First highlight.

---

Title: Missing url
Highlights:
Should be ignored.

---

Title: Second result
URL: https://example.com/second
Text: Second fallback snippet.
    `);

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "First highlight.",
        title: "First result",
        url: "https://example.com/first",
      },
      {
        engine: "Exa",
        snippet: "Second fallback snippet.",
        title: "Second result",
        url: "https://example.com/second",
      },
    ]);
  });
});

describe("parseExaMcpContentItems", () => {
  it("collects text items, dedupes duplicate URLs, and ignores non-text content", () => {
    const results = parseExaMcpContentItems([
      {
        type: "text",
        text: `
Title: GitHub
URL: https://github.com/
Highlights:
GitHub is where people build software.
        `,
      },
      {
        type: "text",
        text: `
Title: GitHub duplicate
URL: https://github.com/
Text: Duplicate entry should be removed.
        `,
      },
      {
        type: "resource",
        text: "ignored",
      },
    ]);

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "GitHub is where people build software.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
  });
});

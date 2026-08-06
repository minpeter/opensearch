import type { CodeSearchResult, FetchResult } from "@minpeter/opensearch";
import { describe, expect, it } from "vitest";

import {
  createCodeSearchToolResult,
  createFetchToolResult,
  createSearchContent,
} from "../tool-io.ts";

function createFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    content: "# Example\n\nBody copy",
    length: "# Example\n\nBody copy".length,
    title: "Example title",
    url: "https://example.com/article",
    ...overrides,
  };
}

describe("createFetchToolResult", () => {
  it("returns a single text-first fetch block with metadata and body", () => {
    const result = createFetchResult();
    const toolResult = createFetchToolResult(result);

    expect(toolResult.content).toEqual([
      {
        text: [
          "Title: Example title",
          "URL: https://example.com/article",
          `Length: ${result.length}`,
          "",
          "# Example",
          "",
          "Body copy",
        ].join("\n"),
        type: "text",
      },
    ]);
    expect(toolResult).not.toHaveProperty("structuredContent");
  });

  it("returns text-first blocks for multi-fetch responses without structured output", () => {
    const first = createFetchResult();
    const second = createFetchResult({
      content: "Second body",
      length: "Second body".length,
      title: "Second title",
      url: "https://example.com/second",
    });

    const toolResult = createFetchToolResult([first, second]);

    expect(toolResult.content).toHaveLength(3);
    expect(toolResult.content[0]).toEqual({
      text: "Fetched 2 URLs. Each block below contains source metadata followed by extracted markdown.",
      type: "text",
    });
    expect(toolResult.content[1]?.text).toContain("Title: Example title");
    expect(toolResult.content[1]?.text).toContain(
      "URL: https://example.com/article"
    );
    expect(toolResult.content[2]?.text).toContain("Title: Second title");
    expect(toolResult).not.toHaveProperty("structuredContent");
  });
});

describe("createSearchContent", () => {
  it("renders compact human-readable search text", () => {
    const content = createSearchContent("example query", [
      {
        engine: "Brave",
        snippet: "Example snippet",
        title: "Example",
        url: "https://example.com",
      },
    ]);

    expect(content).toContain('Returned 1 search results for "example query".');
    expect(content).toContain("Title: Example");
    expect(content).toContain("Highlights: Example snippet");
  });
});

describe("createToolErrorResponse", () => {
  it("preserves the message from plain-object errors", async () => {
    const { createToolErrorResponse } = await import("../tool-io.ts");
    const response = createToolErrorResponse("web_search", "Search", {
      message: "quota exceeded",
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("quota exceeded");
    expect(response.content[0]?.text).not.toContain("[object Object]");
  });

  it("passes Error instances through unchanged", async () => {
    const { createToolErrorResponse } = await import("../tool-io.ts");
    const response = createToolErrorResponse(
      "web_fetch",
      "Fetch",
      new Error("network down")
    );

    expect(response.content[0]?.text).toContain("network down");
  });

  it("falls back to String() for primitives", async () => {
    const { createToolErrorResponse } = await import("../tool-io.ts");
    const response = createToolErrorResponse(
      "web_fetch",
      "Fetch",
      "raw string failure"
    );

    expect(response.content[0]?.text).toContain("raw string failure");
  });
});

describe("createCodeSearchToolResult", () => {
  it("preserves repository, path, provider, lines, and snippets for agents", () => {
    const results: CodeSearchResult[] = [
      {
        language: "TypeScript",
        matches: [{ lineEnd: 366, lineStart: 364, snippet: "isError: true" }],
        path: "src/pages/api/mcp.ts",
        provider: "grep",
        repo: "f/prompts.chat",
        url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
      },
    ];

    const toolResult = createCodeSearchToolResult(results);

    expect(toolResult.content[0]).toEqual({
      text: [
        "Repository: f/prompts.chat",
        "Path: src/pages/api/mcp.ts",
        "URL: https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
        "Provider: grep",
        "Language: TypeScript",
        "",
        "Lines 364-366:",
        "isError: true",
      ].join("\n"),
      type: "text",
    });
  });
});

import type { CodeSearchResult, FetchResult } from "@minpeter/opensearch";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";

import {
  codeSearchInputSchema,
  createCodeSearchToolResult,
  createFetchToolResult,
  createSearchContent,
  getCodeSearchOptions,
  getFetchMaxCharacters,
  getSearchResultCount,
  webFetchInputSchema,
  webSearchInputSchema,
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

describe("codeSearchInputSchema", () => {
  it("maps provider-neutral filters", () => {
    const input = codeSearchInputSchema.parse({
      language: "TypeScript",
      numResults: 7,
      path: "src/",
      query: "isError: true",
      repo: "f/prompts.chat",
      sources: ["github", "grep"],
      useRegexp: false,
    });

    expect(getCodeSearchOptions(input)).toEqual({
      language: "TypeScript",
      numResults: 7,
      path: "src/",
      repo: "f/prompts.chat",
      sources: ["github", "grep"],
      useRegexp: false,
    });
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      codeSearchInputSchema.parse({ query: "isError", sources: ["unknown"] })
    ).toThrow();
  });
});

describe("webFetchInputSchema", () => {
  it("accepts Exa-style numResults for search result limits", () => {
    const parsed = webSearchInputSchema.parse({
      numResults: 7,
      query: "example query",
    });

    expect(getSearchResultCount(parsed)).toBe(7);
  });

  it("still accepts the max_results compatibility alias for search result limits", () => {
    const parsed = webSearchInputSchema.parse({
      max_results: 3,
      query: "example query",
    });

    expect(getSearchResultCount(parsed)).toBe(3);
  });

  it("defaults search result limits when neither field is provided", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
    });

    expect(getSearchResultCount(parsed)).toBe(5);
  });

  it("accepts batch urls", () => {
    const parsed = webFetchInputSchema.parse({
      urls: ["https://example.com/one", "https://example.com/two"],
    });

    expect(parsed.urls).toHaveLength(2);
  });

  it("requires urls instead of the removed url alias", () => {
    expect(() =>
      webFetchInputSchema.parse({
        url: "https://example.com/removed-url-alias",
      })
    ).toThrow();
  });

  it("accepts maxCharacters for batched fetch requests", () => {
    const parsed = webFetchInputSchema.parse({
      maxCharacters: 4000,
      urls: ["https://example.com/one"],
    });

    expect(getFetchMaxCharacters(parsed)).toBe(4000);
  });

  it("remains exportable as an object schema for listTools", () => {
    const normalizedSchema = normalizeObjectSchema(webFetchInputSchema);
    const jsonSchema = normalizedSchema
      ? toJsonSchemaCompat(normalizedSchema)
      : undefined;

    expect(normalizedSchema).toBeDefined();
    expect(jsonSchema?.properties).toMatchObject({
      maxCharacters: expect.objectContaining({ type: "integer" }),
      urls: expect.objectContaining({ type: "array" }),
    });
    expect(jsonSchema?.properties).not.toHaveProperty("url");
  });
});

describe("webSearchInputSchema", () => {
  it("accepts numResults as the preferred result-count field", () => {
    const parsed = webSearchInputSchema.parse({
      numResults: 7,
      query: "example query",
    });

    expect(parsed).toEqual({
      numResults: 7,
      query: "example query",
    });
  });

  it("maps the max_results compatibility alias to numResults", () => {
    const parsed = webSearchInputSchema.parse({
      max_results: 4,
      query: "example query",
    });

    expect(parsed).toEqual({
      max_results: 4,
      query: "example query",
    });
  });

  it("prefers numResults when both fields are provided", () => {
    const parsed = webSearchInputSchema.parse({
      max_results: 3,
      numResults: 6,
      query: "example query",
    });

    expect(parsed).toEqual({
      max_results: 3,
      numResults: 6,
      query: "example query",
    });
  });

  it("remains exportable as an object schema for listTools", () => {
    const normalizedSchema = normalizeObjectSchema(webSearchInputSchema);
    const jsonSchema = normalizedSchema
      ? toJsonSchemaCompat(normalizedSchema)
      : undefined;

    expect(normalizedSchema).toBeDefined();
    expect(jsonSchema?.properties).toMatchObject({
      max_results: expect.objectContaining({ type: "integer" }),
      numResults: expect.objectContaining({ type: "integer" }),
      query: expect.objectContaining({ type: "string" }),
    });
  });
});

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

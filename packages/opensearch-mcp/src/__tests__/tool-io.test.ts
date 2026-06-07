import type { FetchResult } from "@minpeter/opensearch";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";

import {
  createFetchToolResult,
  createSearchContent,
  getFetchMaxCharacters,
  getSearchResultCount,
  webFetchInputSchema,
  webSearchInputSchema,
} from "../tool-io.ts";

function createFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    title: "Example title",
    url: "https://example.com/article",
    content: "# Example\n\nBody copy",
    length: "# Example\n\nBody copy".length,
    ...overrides,
  };
}

describe("webFetchInputSchema", () => {
  it("accepts Exa-style numResults for search result limits", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
      numResults: 7,
    });

    expect(getSearchResultCount(parsed)).toBe(7);
  });

  it("still accepts the max_results compatibility alias for search result limits", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
      max_results: 3,
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
      urls: ["https://example.com/one"],
      maxCharacters: 4000,
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
      urls: expect.objectContaining({ type: "array" }),
      maxCharacters: expect.objectContaining({ type: "integer" }),
    });
    expect(jsonSchema?.properties).not.toHaveProperty("url");
  });
});

describe("webSearchInputSchema", () => {
  it("accepts numResults as the preferred result-count field", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
      numResults: 7,
    });

    expect(parsed).toEqual({
      query: "example query",
      numResults: 7,
    });
  });

  it("maps the max_results compatibility alias to numResults", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
      max_results: 4,
    });

    expect(parsed).toEqual({
      query: "example query",
      max_results: 4,
    });
  });

  it("prefers numResults when both fields are provided", () => {
    const parsed = webSearchInputSchema.parse({
      query: "example query",
      numResults: 6,
      max_results: 3,
    });

    expect(parsed).toEqual({
      query: "example query",
      numResults: 6,
      max_results: 3,
    });
  });

  it("remains exportable as an object schema for listTools", () => {
    const normalizedSchema = normalizeObjectSchema(webSearchInputSchema);
    const jsonSchema = normalizedSchema
      ? toJsonSchemaCompat(normalizedSchema)
      : undefined;

    expect(normalizedSchema).toBeDefined();
    expect(jsonSchema?.properties).toMatchObject({
      query: expect.objectContaining({ type: "string" }),
      numResults: expect.objectContaining({ type: "integer" }),
      max_results: expect.objectContaining({ type: "integer" }),
    });
  });
});

describe("createFetchToolResult", () => {
  it("returns a single text-first fetch block with metadata and body", () => {
    const result = createFetchResult();
    const toolResult = createFetchToolResult(result);

    expect(toolResult.content).toEqual([
      {
        type: "text",
        text: [
          "Title: Example title",
          "URL: https://example.com/article",
          `Length: ${result.length}`,
          "",
          "# Example",
          "",
          "Body copy",
        ].join("\n"),
      },
    ]);
    expect(toolResult).not.toHaveProperty("structuredContent");
  });

  it("returns text-first blocks for multi-fetch responses without structured output", () => {
    const first = createFetchResult();
    const second = createFetchResult({
      title: "Second title",
      url: "https://example.com/second",
      content: "Second body",
      length: "Second body".length,
    });

    const toolResult = createFetchToolResult([first, second]);

    expect(toolResult.content).toHaveLength(3);
    expect(toolResult.content[0]).toEqual({
      type: "text",
      text: "Fetched 2 URLs. Each block below contains source metadata followed by extracted markdown.",
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
        title: "Example",
        url: "https://example.com",
        snippet: "Example snippet",
      },
    ]);

    expect(content).toContain('Returned 1 search results for "example query".');
    expect(content).toContain("Title: Example");
    expect(content).toContain("Highlights: Example snippet");
  });
});

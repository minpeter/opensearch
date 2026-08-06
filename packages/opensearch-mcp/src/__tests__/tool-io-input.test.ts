import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";

import {
  codeSearchInputSchema,
  getCodeSearchOptions,
  getSearchResultCount,
  webFetchInputSchema,
  webSearchInputSchema,
} from "../tool-io.ts";

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

    expect(parsed.maxCharacters).toBe(4000);
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

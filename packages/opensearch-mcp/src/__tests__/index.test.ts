import { describe, expect, it } from "vitest";

import { createFetchToolResult, createSearchToolResult } from "../tool-io.ts";

describe("tool result shaping", () => {
  it("renders search results as Exa-style text without structured output", () => {
    const results = [
      {
        engine: "Bing",
        snippet: "Typed JavaScript at scale.",
        title: "TypeScript",
        url: "https://www.typescriptlang.org/",
      },
    ];

    const toolResult = createSearchToolResult("typescript", results);

    expect(toolResult.content).toEqual([
      {
        type: "text",
        text: [
          'Returned 1 search results for "typescript".',
          "",
          "Title: TypeScript",
          "URL: https://www.typescriptlang.org/",
          "Highlights: Typed JavaScript at scale.",
          "Source: Bing",
        ].join("\n"),
      },
    ]);
    expect(toolResult).not.toHaveProperty("structuredContent");
  });

  it("returns fetch content as a text-first block with source metadata", () => {
    const toolResult = createFetchToolResult({
      content: "# Example\n\nBody text",
      length: 20,
      title: "Example",
      url: "https://example.com",
    });

    expect(toolResult.content).toEqual([
      {
        type: "text",
        text: [
          "Title: Example",
          "URL: https://example.com",
          "Length: 20",
          "",
          "# Example",
          "",
          "Body text",
        ].join("\n"),
      },
    ]);
    expect(toolResult).not.toHaveProperty("structuredContent");
  });
});

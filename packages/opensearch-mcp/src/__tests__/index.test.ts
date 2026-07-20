import { describe, expect, it } from "vitest";

import { webSearchDescription } from "../tool-descriptions.ts";
import { createFetchToolResult, createSearchToolResult } from "../tool-io.ts";

describe("tool result shaping", () => {
  it("describes web_search as ranked results rather than full page content", () => {
    expect(webSearchDescription).toContain("ranked search results");
    expect(webSearchDescription).toContain("titles, URLs, highlights");
    expect(webSearchDescription).toContain(
      "Follow promising URLs with web_fetch"
    );
    expect(webSearchDescription).not.toContain("ready-to-use content");
    expect(webSearchDescription).not.toContain(
      "Clean text content from top search results"
    );
  });

  it("renders search results as Exa-style text without structured output", () => {
    const results = [
      {
        engine: "DuckDuckGo",
        snippet: "Typed JavaScript at scale.",
        title: "TypeScript",
        url: "https://www.typescriptlang.org/",
      },
    ];

    const toolResult = createSearchToolResult("typescript", results);

    expect(toolResult.content).toEqual([
      {
        text: [
          'Returned 1 search results for "typescript".',
          "",
          "Title: TypeScript",
          "URL: https://www.typescriptlang.org/",
          "Highlights: Typed JavaScript at scale.",
          "Source: DuckDuckGo",
        ].join("\n"),
        type: "text",
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
        text: [
          "Title: Example",
          "URL: https://example.com",
          "Length: 20",
          "",
          "# Example",
          "",
          "Body text",
        ].join("\n"),
        type: "text",
      },
    ]);
    expect(toolResult).not.toHaveProperty("structuredContent");
  });
});

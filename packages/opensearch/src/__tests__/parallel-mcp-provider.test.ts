import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARALLEL_MCP_SERVER_URL,
  parseParallelMcpContentItems,
  parseParallelMcpToolText,
} from "../parallel-mcp-provider.ts";

describe("Parallel MCP provider parsing", () => {
  it("targets the anonymous hosted Parallel Search MCP endpoint", () => {
    expect(DEFAULT_PARALLEL_MCP_SERVER_URL).toBe(
      "https://search.parallel.ai/mcp"
    );
  });

  it("parses JSON text content from the web_search MCP tool", () => {
    const results = parseParallelMcpToolText(
      JSON.stringify({
        results: [
          {
            excerpts: ["First excerpt.", "Second excerpt."],
            title: "Parallel result",
            url: "https://example.com/parallel",
          },
          {
            content: "Duplicate URL should be ignored.",
            title: "Parallel duplicate",
            url: "https://example.com/parallel",
          },
        ],
        search_id: "search_123",
        session_id: "session_123",
      })
    );

    expect(results).toEqual([
      {
        engine: "Parallel",
        snippet: "First excerpt. Second excerpt.",
        title: "Parallel result",
        url: "https://example.com/parallel",
      },
    ]);
  });

  it("collects text content items and ignores malformed content", () => {
    const results = parseParallelMcpContentItems([
      { type: "resource", text: "ignored" },
      { type: "text", text: "not json" },
      {
        type: "text",
        text: JSON.stringify({
          results: [
            {
              content: "Structured MCP content fallback.",
              title: "Structured result",
              url: "https://example.com/structured",
            },
          ],
          search_id: "search_456",
          session_id: "session_456",
        }),
      },
    ]);

    expect(results).toEqual([
      {
        engine: "Parallel",
        snippet: "Structured MCP content fallback.",
        title: "Structured result",
        url: "https://example.com/structured",
      },
    ]);
  });
});

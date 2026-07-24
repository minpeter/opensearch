import { vi } from "vitest";

import type { SearchProvider, SearchResult } from "../search/types.ts";

export const DISABLE_HOSTED_ENV = {
  OPENSEARCH_ENABLE_EXA_MCP: "false",
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
  OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
} as const;

export const searchResult: SearchResult = {
  engine: "DuckDuckGo",
  snippet: "Observed without exposing the query.",
  title: "Observable result",
  url: "https://example.com/result",
};

export function successfulSearchProvider(): SearchProvider {
  return {
    name: "DuckDuckGo",
    search: vi.fn().mockResolvedValue([searchResult]),
  };
}

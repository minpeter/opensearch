import type { FetchResult } from "@minpeter/opensearch";
import { z } from "zod";

const textContentType = "text" as const;
const MAX_FETCH_URLS = 10;
const DEFAULT_SEARCH_RESULT_COUNT = 5;
const MAX_SEARCH_RESULTS = 15;

const searchResultCountSchema = z.int().positive().max(MAX_SEARCH_RESULTS);

export interface SearchToolResultItem {
  engine: string;
  snippet: string;
  title: string;
  url: string;
}

export const webSearchInputSchema = z.object({
  query: z
    .string()
    .describe(
      "Natural language search query. Describe the ideal page, not just keywords."
    ),
  numResults: searchResultCountSchema
    .optional()
    .describe("Number of search results to return (default: 5, range: 1-15)."),
  max_results: searchResultCountSchema
    .optional()
    .describe(
      "Backward-compatible alias for numResults. Number of search results to return (default: 5, range: 1-15)."
    ),
});

export const webFetchInputSchema = z.object({
  urls: z
    .array(z.url())
    .min(1)
    .max(MAX_FETCH_URLS)
    .describe("URLs to read. Batch multiple URLs in one call."),
  maxCharacters: z
    .int()
    .positive()
    .optional()
    .describe(
      "Maximum characters to extract per page (must be a positive number, default: 12000)."
    ),
});

export function createSearchContent(
  query: string,
  results: SearchToolResultItem[]
): string {
  const lines = results.map((result) =>
    [
      `Title: ${result.title}`,
      `URL: ${result.url}`,
      `Highlights: ${result.snippet}`,
      `Source: ${result.engine}`,
    ].join("\n")
  );

  return `Returned ${results.length} search results for "${query}".\n\n${lines.join("\n\n")}`;
}

export function createSearchToolResult(
  query: string,
  results: SearchToolResultItem[]
) {
  return {
    content: [
      { type: textContentType, text: createSearchContent(query, results) },
    ],
  };
}

export function getSearchResultCount(
  input: z.infer<typeof webSearchInputSchema>
): number {
  return input.numResults ?? input.max_results ?? DEFAULT_SEARCH_RESULT_COUNT;
}

export function getFetchMaxCharacters(
  input: z.infer<typeof webFetchInputSchema>
): number | undefined {
  return input.maxCharacters;
}

function createFetchContentBlock(result: FetchResult): string {
  const title = result.title || result.url;

  return `Title: ${title}\nURL: ${result.url}\nLength: ${result.length}\n\n${result.content}`;
}

export function createFetchToolResult(results: FetchResult | FetchResult[]) {
  const normalizedResults = Array.isArray(results) ? results : [results];
  const [firstResult] = normalizedResults;

  if (!firstResult) {
    throw new Error("Fetch returned no results");
  }

  if (normalizedResults.length === 1) {
    return {
      content: [
        {
          type: textContentType,
          text: createFetchContentBlock(firstResult),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: textContentType,
        text: `Fetched ${normalizedResults.length} URLs. Each block below contains source metadata followed by extracted markdown.`,
      },
      ...normalizedResults.map((result) => ({
        type: textContentType,
        text: createFetchContentBlock(result),
      })),
    ],
  };
}

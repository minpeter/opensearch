import { z } from "zod";

export const DEFAULT_SEARCH_RESULT_COUNT = 5;
export const MAX_FETCH_URLS = 10;
export const MAX_SEARCH_RESULTS = 15;

const SEARCH_ENGINE_NAMES = [
  "Brave",
  "BrightData",
  "DataForSEO",
  "DuckDuckGo",
  "Exa",
  "Firecrawl",
  "Google",
  "Jina",
  "Kagi",
  "Linkup",
  "Mojeek",
  "Parallel",
  "Perplexity",
  "ScrapingBee",
  "SearchAPI",
  "SearxNG",
  "SerpAPI",
  "Serper",
  "Tavily",
  "TinyFish",
  "Valyu",
  "You",
] as const;

const searchResultCountSchema = z.int().positive().max(MAX_SEARCH_RESULTS);

export const webSearchInputSchema = z.strictObject({
  query: z
    .string()
    .describe(
      "Natural language search query. Describe the ideal page, not just keywords."
    ),
  numResults: searchResultCountSchema
    .optional()
    .describe("Number of search results to return (default: 5, range: 1-15)."),
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

const webSearchResultSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_NAMES),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const webFetchResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  length: z.number(),
});

export const webSearchOutputSchema = z.array(webSearchResultSchema);
export const webFetchOutputSchema = z.array(webFetchResultSchema);

export interface WebSearchInput {
  readonly numResults?: number;
  readonly query: string;
}

export interface WebFetchInput {
  readonly maxCharacters?: number;
  readonly urls: readonly string[];
}

export type WebSearchResult = z.infer<typeof webSearchResultSchema>;
export type WebFetchResult = z.infer<typeof webFetchResultSchema>;

import { z } from "zod";

export const SEARCH_ENGINE_NAMES = [
  "Anthropic",
  "Brave",
  "BrightData",
  "DataForSEO",
  "DuckDuckGo",
  "Exa",
  "Firecrawl",
  "Google",
  "Jina",
  "Kagi",
  "Kimi",
  "Linkup",
  "Mojeek",
  "Ollama",
  "OpenAI",
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
  "xAI",
  "You",
  "Z.ai",
] as const;

export type SearchEngineName = (typeof SEARCH_ENGINE_NAMES)[number];

export const searchResultSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_NAMES),
  snippet: z.string(),
  title: z.string(),
  url: z.string(),
});

export const searchResultsSchema = z.array(searchResultSchema);

export type SearchResult = z.infer<typeof searchResultSchema>;
export type ParsedResult = Omit<SearchResult, "engine">;

export type EngineFailureKind =
  | "blocked"
  | "misconfigured"
  | "no-results"
  | "transient";

export interface SearchProvider {
  readonly name: SearchEngineName;
  search: (query: string, numResults: number) => Promise<SearchResult[]>;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturesDir = join(import.meta.dirname, "fixtures");
const ORIGINAL_ENV = { ...process.env };

const SEARCH_ENV_KEYS = [
  "BING_SEARCH_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "BRIGHT_DATA_SERP_API_KEY",
  "BRIGHT_DATA_SERP_ZONE",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "GOOGLE_CUSTOM_SEARCH_API_KEY",
  "GOOGLE_CUSTOM_SEARCH_ENGINE_ID",
  "JINA_API_KEY",
  "KAGI_API_KEY",
  "KAGI_API_TOKEN",
  "LINKUP_API_KEY",
  "MOJEEK_API_KEY",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "OPENSEARCH_BING_API_URL",
  "OPENSEARCH_BRIGHT_DATA_SERP_URL",
  "OPENSEARCH_BRIGHT_DATA_SERP_ZONE",
  "OPENSEARCH_DATAFORSEO_URL",
  "OPENSEARCH_ENABLE_EXA_MCP",
  "OPENSEARCH_ENABLE_GOOGLE_SCRAPE",
  "OPENSEARCH_ENABLE_PARALLEL_MCP",
  "OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS",
  "OPENSEARCH_EXA_MCP_URL",
  "OPENSEARCH_FIRECRAWL_URL",
  "OPENSEARCH_GOOGLE_CSE_URL",
  "OPENSEARCH_JINA_SEARCH_URL",
  "OPENSEARCH_KAGI_URL",
  "OPENSEARCH_LINKUP_URL",
  "OPENSEARCH_INTERNET_ARCHIVE_URL",
  "OPENSEARCH_MOJEEK_URL",
  "OPENSEARCH_NAVER_URL",
  "OPENSEARCH_PARALLEL_URL",
  "OPENSEARCH_PERPLEXITY_URL",
  "OPENSEARCH_SCRAPINGBEE_URL",
  "OPENSEARCH_SEARCHAPI_URL",
  "OPENSEARCH_SEARXNG_URLS",
  "OPENSEARCH_SERPAPI_URL",
  "OPENSEARCH_SERPER_URL",
  "OPENSEARCH_STARTPAGE_URL",
  "OPENSEARCH_TAVILY_URL",
  "OPENSEARCH_VALYU_URL",
  "OPENSEARCH_WEBCRAWLER_URL",
  "OPENSEARCH_WIBY_URL",
  "OPENSEARCH_WIKIPEDIA_URL",
  "OPENSEARCH_YOU_URL",
  "PARALLEL_API_KEY",
  "PERPLEXITY_API_KEY",
  "SCRAPINGBEE_API_KEY",
  "SEARCHAPI_API_KEY",
  "SERPAPI_API_KEY",
  "SERPER_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "VALYU_API_KEY",
  "YOU_API_KEY",
] as const;

export function createMockResponse(html: string, status = 200): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
    status,
  });
}

export function createMockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

export function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

export function resetSearchEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  for (const key of SEARCH_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
  process.env.OPENSEARCH_ENABLE_PARALLEL_MCP = "false";
  process.env.OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS = "false";
}

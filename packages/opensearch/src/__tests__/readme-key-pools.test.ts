import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readme = readFileSync(
  new URL("../../../../README.md", import.meta.url),
  "utf8"
);

const apiKeyPoolEnvNames = [
  "TINYFISH_API_KEY",
  "TAVILY_API_KEY",
  "FIRECRAWL_API_KEY",
  "PARALLEL_API_KEY",
  "YOU_API_KEY",
  "PERPLEXITY_API_KEY",
  "VALYU_API_KEY",
  "LINKUP_API_KEY",
  "JINA_API_KEY",
  "SERPER_API_KEY",
  "SERPAPI_API_KEY",
  "GOOGLE_CUSTOM_SEARCH_API_KEY",
  "BRIGHT_DATA_SERP_API_KEY",
  "SCRAPINGBEE_API_KEY",
  "SEARCHAPI_API_KEY",
  "KAGI_API_KEY",
  "KAGI_API_TOKEN",
  "MOJEEK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "EXA_API_KEY",
] as const;

describe("README API key pool docs", () => {
  it("documents semicolon-delimited pools for every key-backed provider env", () => {
    expect(readme).toContain("### API key pools");
    expect(readme).toContain("semicolon-delimited");

    for (const envName of apiKeyPoolEnvNames) {
      expect(readme).toContain(envName);
    }
  });
});

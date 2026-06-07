import { type CheerioAPI, load } from "cheerio";

import { getErrorMessage, SearchEngineError } from "./errors.ts";
import {
  classifyStatusFailure,
  createSearchRequestInit,
  createSearchUrl,
} from "./http.ts";
import { extractHeuristicResults } from "./scrape-heuristic.ts";
import { normalizeBingUrl } from "./scrape-url.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "./types.ts";

type ScrapeEngineName = Extract<SearchEngineName, "Bing" | "DuckDuckGo">;

interface ScrapeSearchEngine {
  getRequestInit(query: string): {
    readonly init: RequestInit;
    readonly url: string;
  };
  readonly name: ScrapeEngineName;
  parse(html: string): ParsedResult[];
}

interface SearchParserConfig {
  readonly blockedMessage: string;
  readonly detectBlocked?: ($: CheerioAPI, pageText: string) => boolean;
  readonly detectNoResults?: ($: CheerioAPI, pageText: string) => boolean;
  readonly engine: ScrapeEngineName;
  extractResults($: CheerioAPI): ParsedResult[];
}

export const SCRAPE_SEARCH_ENGINES: Record<
  ScrapeEngineName,
  ScrapeSearchEngine
> = {
  Bing: {
    name: "Bing",
    getRequestInit(query: string) {
      return {
        init: createSearchRequestInit("GET"),
        url: createSearchUrl("https://www.bing.com/search", {
          q: query,
          setlang: "en-US",
        }),
      };
    },
    parse: parseBingResults,
  },
  DuckDuckGo: {
    name: "DuckDuckGo",
    getRequestInit(query: string) {
      const formData = new FormData();
      formData.append("q", query);

      return {
        init: createSearchRequestInit("POST", formData),
        url: "https://html.duckduckgo.com/html/",
      };
    },
    parse: parseDuckDuckGoResults,
  },
};

export function createScrapeSearchProvider(
  engine: ScrapeSearchEngine
): SearchProvider {
  return {
    name: engine.name,
    search(query: string): Promise<SearchResult[]> {
      return searchWithScrapeEngine(engine, query);
    },
  };
}

async function searchWithScrapeEngine(
  engine: ScrapeSearchEngine,
  query: string
): Promise<SearchResult[]> {
  const { init, url } = engine.getRequestInit(query);
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new SearchEngineError(
      engine.name,
      "transient",
      `${engine.name} fetch failed: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    throw new SearchEngineError(
      engine.name,
      classifyStatusFailure(response.status),
      `${engine.name} fetch failed with status ${response.status}`
    );
  }

  const html = await response.text();
  return attachEngine(engine.name, engine.parse(html));
}

function parseDuckDuckGoResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    blockedMessage: "Too many requests (Bot detected)",
    detectBlocked: ($) => $(".challenge-form, #challenge-form").length > 0,
    detectNoResults: ($) => $(".no-results").length > 0,
    engine: "DuckDuckGo",
    extractResults: ($) =>
      collectResults(
        $,
        ".zci, #links > .result, .result.results_links, .result.results_links_deep",
        ($result) => {
          const anchor = $result(
            ".zci__heading > a, .result__title .result__a, .result__a"
          ).first();

          return {
            snippet: $result(".zci__result, .result__snippet")
              .first()
              .text()
              .trim(),
            title: anchor.text().trim(),
            url: anchor.attr("href")?.trim() ?? "",
          };
        }
      ),
  });
}

function parseBingResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    blockedMessage: "Bing blocked the request",
    detectBlocked: (_, pageText) =>
      pageText.includes("One last step") ||
      pageText.includes("Enter the characters you see below") ||
      pageText.includes("Please solve this puzzle") ||
      pageText.includes("verify you are a human"),
    detectNoResults: ($, pageText) =>
      pageText.includes("There are no results for") ||
      pageText.includes("No results found for") ||
      pageText.includes("There are no results for this question") ||
      $(".b_no").length > 0,
    engine: "Bing",
    extractResults: ($) =>
      collectResults($, "li.b_algo", ($result) => {
        const anchor = $result("h2 a").first();

        return {
          snippet: $result(".b_caption p, .b_snippet").first().text().trim(),
          title: anchor.text().trim(),
          url: normalizeBingUrl(anchor.attr("href")?.trim() ?? ""),
        };
      }),
  });
}

function parseEngineResults(
  html: string,
  {
    blockedMessage,
    detectBlocked,
    detectNoResults,
    engine,
    extractResults,
  }: SearchParserConfig
): ParsedResult[] {
  const $ = load(html);
  const pageText = $.text();

  if (detectNoResults?.($, pageText)) {
    throw new SearchEngineError(engine, "no-results", "No Results");
  }

  if (detectBlocked?.($, pageText)) {
    throw new SearchEngineError(engine, "blocked", blockedMessage);
  }

  return ensureResults(extractResults($), $, engine);
}

function collectResults(
  $: CheerioAPI,
  selector: string,
  getResult: (result: CheerioAPI) => ParsedResult
): ParsedResult[] {
  const results: ParsedResult[] = [];

  $(selector).each((_, element) => {
    const resultHtml = $.html(element);
    if (!resultHtml) {
      return;
    }

    const normalizedResult = normalizeResult(getResult(load(resultHtml)));
    if (normalizedResult) {
      results.push(normalizedResult);
    }
  });

  return dedupeResults(results);
}

function ensureResults(
  selectorResults: ParsedResult[],
  $: CheerioAPI,
  engine: ScrapeEngineName
): ParsedResult[] {
  if (selectorResults.length > 0) {
    return selectorResults;
  }

  const heuristicResults = extractHeuristicResults($, engine);
  if (heuristicResults.length > 0) {
    return heuristicResults;
  }

  throw new SearchEngineError(engine, "no-results", "No Results");
}

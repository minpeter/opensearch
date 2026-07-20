import { type CheerioAPI, load } from "cheerio/slim";

import { cancelResponseBody, readResponseText } from "../response-body.ts";
import { getErrorMessage, SearchEngineError } from "./errors.ts";
import { classifyStatusFailure, createSearchRequestInit } from "./http.ts";
import { extractHeuristicResults } from "./scrape-heuristic.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "./types.ts";

type ScrapeEngineName = Extract<SearchEngineName, "DuckDuckGo">;

interface ScrapeSearchEngine {
  getRequestInit: (query: string) => {
    readonly init: RequestInit;
    readonly url: string;
  };
  readonly name: ScrapeEngineName;
  parse: (html: string) => ParsedResult[];
}

interface SearchParserConfig {
  readonly blockedMessage: string;
  readonly detectBlocked?: ($: CheerioAPI, pageText: string) => boolean;
  readonly detectNoResults?: ($: CheerioAPI, pageText: string) => boolean;
  readonly engine: ScrapeEngineName;
  extractResults: ($: CheerioAPI) => ParsedResult[];
}

export const SCRAPE_SEARCH_ENGINES: Record<
  ScrapeEngineName,
  ScrapeSearchEngine
> = {
  DuckDuckGo: {
    getRequestInit(query: string) {
      const formData = new FormData();
      formData.append("q", query);

      return {
        init: createSearchRequestInit("POST", formData),
        url: "https://html.duckduckgo.com/html/",
      };
    },
    name: "DuckDuckGo",
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
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      engine.name,
      "transient",
      `${engine.name} fetch failed: ${getErrorMessage(error)}`,
      { cause: error }
    );
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new SearchEngineError(
      engine.name,
      classifyStatusFailure(response.status),
      `${engine.name} fetch failed with status ${response.status}`,
      { status: response.status }
    );
  }

  let html: string;
  try {
    html = await readResponseText(response);
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      engine.name,
      "transient",
      `${engine.name} response body could not be read: ${getErrorMessage(
        error
      )}`,
      { cause: error }
    );
  }
  return attachEngine(engine.name, engine.parse(html));
}

function parseDuckDuckGoResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    // DuckDuckGo serves an HTTP 202 anti-bot challenge page (a `challenge-form`)
    // rather than an HTTP 429. Keep rate-limit keywords ("too many requests",
    // "rate limit", "429") OUT of this message so the bench classifies it as a
    // bot block, not a rate limit (the bench infers rate limiting from the
    // message when no 429 status is present).
    blockedMessage: "Bot challenge / anomaly page",
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

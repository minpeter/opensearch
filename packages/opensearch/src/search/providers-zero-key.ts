import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { getBaseUrl } from "./api-provider-utils.ts";
import { getErrorMessage, SearchEngineError } from "./errors.ts";
import {
  createSearchRequestInit,
  createSearchUrl,
  fetchSearchText,
} from "./http.ts";
import { attachEngine } from "./text.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import {
  parseStartpageResults,
  parseWebcrawlerResults,
} from "./zero-key-parsers.ts";

type HtmlParser = (html: string) => ParsedResult[];

export function createZeroKeyProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return [
    createHtmlProvider(
      "Startpage",
      (query) => createStartpageUrl(query, env),
      parseStartpageResults
    ),
    createHtmlProvider(
      "Webcrawler",
      (query) => createWebcrawlerUrl(query, env),
      parseWebcrawlerResults
    ),
  ];
}

function createHtmlProvider(
  name: SearchEngineName,
  createUrl: (query: string) => string,
  parse: HtmlParser
): SearchProvider {
  return {
    name,
    async search(query: string, numResults: number) {
      try {
        const body = await fetchSearchText({
          engine: name,
          init: createSearchRequestInit("GET"),
          url: createUrl(query),
        });
        return limitResults(name, parse(body), numResults);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          throw error;
        }
        throw toProviderError(name, error);
      }
    },
  };
}

function toProviderError(
  engine: SearchEngineName,
  error: unknown
): SearchEngineError {
  return new SearchEngineError(
    engine,
    "misconfigured",
    `${engine} search failed: ${getErrorMessage(error)}`
  );
}

function limitResults(
  engine: SearchEngineName,
  results: ParsedResult[],
  numResults: number
): SearchResult[] {
  const limitedResults = results.slice(0, numResults);
  if (limitedResults.length === 0) {
    throw new SearchEngineError(engine, "no-results", "No Results");
  }

  return attachEngine(engine, limitedResults);
}

function createStartpageUrl(query: string, env: EnvironmentReader): string {
  return createSearchUrl(
    getBaseUrl(
      "OPENSEARCH_STARTPAGE_URL",
      "https://www.startpage.com/sp/search",
      env
    ),
    { cat: "web", query }
  );
}

function createWebcrawlerUrl(query: string, env: EnvironmentReader): string {
  return createSearchUrl(
    getBaseUrl(
      "OPENSEARCH_WEBCRAWLER_URL",
      "https://www.webcrawler.com/serp",
      env
    ),
    { q: query }
  );
}

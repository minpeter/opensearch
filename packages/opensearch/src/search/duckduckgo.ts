import { load } from "cheerio";
import { z } from "zod";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  attachProviderEngine as attachEngine,
  dedupeProviderResults as dedupeResults,
  normalizeProviderResult as normalizeResult,
} from "../providers/shared/result.ts";
import { readResponseText } from "../response-body.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import {
  extractDuckDuckGoVqd,
  isDuckDuckGoChallenge,
  solveDuckDuckGoChallenge,
} from "./duckduckgo-challenge.ts";
import { SearchEngineError } from "./errors.ts";
import { classifyStatusFailure, REQUEST_TIMEOUT_MS } from "./http.ts";
import { createScrapeSearchProvider, SCRAPE_SEARCH_ENGINES } from "./scrape.ts";
import type { ParsedResult, SearchProvider, SearchResult } from "./types.ts";

const ENGINE = "DuckDuckGo" as const;
const HOME_URL = "https://duckduckgo.com/";
const LINKS_URL = "https://links.duckduckgo.com/d.js";

const POW_OPT_OUT_ENV = "OPENSEARCH_ENABLE_DUCKDUCKGO_POW";

const duckDuckGoResponseSchema = z.object({
  results: z
    .array(
      z.object({
        a: z.string().optional(),
        t: z.string().optional(),
        u: z.string().optional(),
      })
    )
    .optional(),
});

function browserHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: HOME_URL,
    "User-Agent": getRandomUserAgent(),
  };
}

interface FetchedText {
  readonly body: string;
  readonly ok: boolean;
  readonly status: number;
}

async function getText(
  url: string,
  headers: Record<string, string>
): Promise<FetchedText> {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      body: await readResponseText(response),
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: SearchEngineError receives the original cause in its fourth argument
    throw new SearchEngineError(
      ENGINE,
      "transient",
      `DuckDuckGo fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

function cleanHtml(value: string): string {
  // DDG snippets/titles carry HTML entities and <b> tags; cheerio decodes both.
  return load(`<x>${value}</x>`)("x").text();
}

export function parseDuckDuckGoJson(body: string): ParsedResult[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }

  const parsed = duckDuckGoResponseSchema.safeParse(payload);
  if (!(parsed.success && parsed.data.results)) {
    return [];
  }

  const results = parsed.data.results
    .map((result) =>
      normalizeResult({
        snippet: cleanHtml(result.a ?? ""),
        title: cleanHtml(result.t ?? ""),
        url: result.u ?? "",
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  return dedupeResults(results);
}

function buildLinksUrl(query: string, vqd: string): string {
  const params = new URLSearchParams({
    dl: "en",
    kl: "wt-wt",
    l: "us-en",
    o: "json",
    q: query,
    s: "0",
    vqd,
  });
  return `${LINKS_URL}?${params.toString()}`;
}

async function searchViaLinks(
  query: string,
  numResults: number
): Promise<SearchResult[]> {
  const headers = browserHeaders();

  const home = await getText(
    `${HOME_URL}?q=${encodeURIComponent(query)}`,
    headers
  );
  const vqd = extractDuckDuckGoVqd(home.body);
  if (!vqd) {
    throw new SearchEngineError(
      ENGINE,
      "blocked",
      "DuckDuckGo did not return a vqd token"
    );
  }

  const base = buildLinksUrl(query, vqd);
  let response = await getText(base, headers);

  if (isDuckDuckGoChallenge(response.body)) {
    const token = solveDuckDuckGoChallenge(response.body);
    if (!token) {
      throw new SearchEngineError(
        ENGINE,
        "blocked",
        "Bot challenge / anomaly page"
      );
    }
    response = await getText(`${base}&${token}`, headers);
    if (isDuckDuckGoChallenge(response.body)) {
      throw new SearchEngineError(
        ENGINE,
        "blocked",
        "Bot challenge / anomaly page"
      );
    }
  }

  if (!response.ok) {
    throw new SearchEngineError(
      ENGINE,
      classifyStatusFailure(response.status),
      `DuckDuckGo fetch failed with status ${response.status}`,
      { status: response.status }
    );
  }

  const results = parseDuckDuckGoJson(response.body);
  if (results.length === 0) {
    throw new SearchEngineError(ENGINE, "no-results", "No Results");
  }
  return attachEngine(ENGINE, results.slice(0, numResults));
}

function isPowEnabled(env: EnvironmentReader): boolean {
  return env.read(POW_OPT_OUT_ENV) !== "false";
}

/**
 * DuckDuckGo provider. Tries the lightweight html.duckduckgo.com scrape first
 * (one request, works on clean IPs) and only escalates to the
 * links.duckduckgo.com JSON API + in-process proof-of-work solver when the
 * scrape is bot-blocked. Non-block failures (no-results / transient) propagate
 * unchanged so the search chain behaves exactly as before on the common path.
 * The escalation is on by default and opt-out via OPENSEARCH_ENABLE_DUCKDUCKGO_POW=false.
 */
export function createDuckDuckGoProvider(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider {
  const scrapeProvider = createScrapeSearchProvider(
    SCRAPE_SEARCH_ENGINES.DuckDuckGo
  );

  return {
    name: ENGINE,
    async search(query: string, numResults: number) {
      try {
        return await scrapeProvider.search(query, numResults);
      } catch (error) {
        if (
          error instanceof SearchEngineError &&
          error.kind === "blocked" &&
          isPowEnabled(env)
        ) {
          return await searchViaLinks(query, numResults);
        }
        throw error;
      }
    },
  };
}

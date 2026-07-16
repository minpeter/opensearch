import { runInNewContext } from "node:vm";
import { load } from "cheerio";
import { JSDOM } from "jsdom";
import { z } from "zod";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { readResponseText } from "../response-body.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { SearchEngineError } from "./errors.ts";
import { classifyStatusFailure, REQUEST_TIMEOUT_MS } from "./http.ts";
import { createScrapeSearchProvider, SCRAPE_SEARCH_ENGINES } from "./scrape.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type { ParsedResult, SearchProvider, SearchResult } from "./types.ts";

const ENGINE = "DuckDuckGo" as const;
const HOME_URL = "https://duckduckgo.com/";
const LINKS_URL = "https://links.duckduckgo.com/d.js";

// DuckDuckGo's result endpoints (links/html) gate suspicious clients behind a
// JS proof-of-work: a 202 body that computes `jsa` (partly from how an HTML
// parser normalizes malformed tags) and calls DDG.deep.initialize(...). We solve
// it headlessly with jsdom (already a dependency) + a locked-down vm sandbox,
// then resubmit with the computed token. See solveChallenge for the safeguards.
const POW_OPT_OUT_ENV = "OPENSEARCH_ENABLE_DUCKDUCKGO_POW";
const CHALLENGE_MARKER = "DDG.deep.initialize";
const CHALLENGE_MAX_BYTES = 50_000;
const CHALLENGE_TIMEOUT_MS = 1000;
const CAPTURED_PATTERN = /^0&jsa_hash=[a-f0-9]+&jsa=-?\d+$/;
const LEADING_TOKEN_PREFIX = /^0&/;

const VQD_PATTERNS = [
  /vqd="([^"]+)"/,
  /vqd='([^']+)'/,
  /"vqd":"([^"]+)"/,
  /vqd=([\d-][\w-]*)&/,
] as const;

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
    throw new SearchEngineError(
      ENGINE,
      "transient",
      `DuckDuckGo fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function extractVqd(html: string): string | null {
  for (const pattern of VQD_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Compute the proof-of-work token by running DDG's challenge script in a
 * locked-down vm context whose only globals are a jsdom `document` (for the
 * HTML-normalization length math) and a DDG stub that captures the result.
 * eval/Function are disabled, the body is size-capped, and execution is
 * time-boxed. Returns the `jsa_hash=...&jsa=...` query fragment, or null if the
 * body is not a recognizable challenge or the output fails validation.
 */
function solveChallenge(challenge: string): string | null {
  if (
    !challenge.includes(CHALLENGE_MARKER) ||
    challenge.length > CHALLENGE_MAX_BYTES
  ) {
    return null;
  }

  const dom = new JSDOM("<!DOCTYPE html><body></body>");
  let captured: unknown = null;
  const sandbox = {
    DDG: {
      deep: {
        initialize: (value: unknown) => {
          captured = value;
        },
      },
    },
    document: dom.window.document,
  };

  try {
    runInNewContext(challenge, sandbox, {
      contextCodeGeneration: { strings: false, wasm: false },
      timeout: CHALLENGE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (typeof captured !== "string" || !CAPTURED_PATTERN.test(captured)) {
    return null;
  }
  return captured.replace(LEADING_TOKEN_PREFIX, "");
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
  const vqd = extractVqd(home.body);
  if (!vqd) {
    throw new SearchEngineError(
      ENGINE,
      "blocked",
      "DuckDuckGo did not return a vqd token"
    );
  }

  const base = buildLinksUrl(query, vqd);
  let response = await getText(base, headers);

  if (response.body.includes(CHALLENGE_MARKER)) {
    const token = solveChallenge(response.body);
    if (!token) {
      throw new SearchEngineError(
        ENGINE,
        "blocked",
        "Bot challenge / anomaly page"
      );
    }
    response = await getText(`${base}&${token}`, headers);
    if (response.body.includes(CHALLENGE_MARKER)) {
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

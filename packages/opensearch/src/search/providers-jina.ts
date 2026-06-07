import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { getBaseUrl, getEnvPool } from "./api-provider-utils.ts";
import { SearchEngineError } from "./errors.ts";
import { fetchSearchText, REQUEST_TIMEOUT_MS } from "./http.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type { ParsedResult, SearchProvider } from "./types.ts";

const JINA_SEARCH_FIELD_PATTERN =
  /^\[(?<index>\d+)\]\s+(?<field>Title|URL Source|Description|Markdown Content):\s*(?<value>.*)$/u;
const JINA_INDEXED_LINE_PATTERN = /^\[\d+\]\s+/u;
const JINA_SEARCH_CONTENT_FIELDS = new Set(["Description", "Markdown Content"]);

interface JinaSearchDraft {
  snippet: string;
  title: string;
  url: string;
}

export function createJinaProviders(
  env: EnvironmentReader = processEnvironmentReader
): SearchProvider[] {
  return getEnvPool("JINA_API_KEY", env).map((apiKey) =>
    createJinaProvider(apiKey, env)
  );
}

function createJinaProvider(
  apiKey: string,
  env: EnvironmentReader
): SearchProvider {
  return {
    name: "Jina",
    async search(query: string, numResults: number) {
      const response = await fetchSearchText({
        engine: "Jina",
        init: {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "User-Agent": getRandomUserAgent(),
            "X-Respond-With": "no-content",
          },
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: createJinaSearchUrl(query, env),
      });

      const results = parseJinaSearchText(response);
      if (results.length === 0) {
        throw new SearchEngineError("Jina", "no-results", "No Results");
      }

      return attachEngine("Jina", results).slice(0, numResults);
    },
  };
}

export function parseJinaSearchText(text: string): ParsedResult[] {
  const drafts = new Map<string, JinaSearchDraft>();
  let activeSnippetIndex = "";

  for (const line of text.split("\n")) {
    const trimmedLine = line.trim();
    const match = JINA_SEARCH_FIELD_PATTERN.exec(trimmedLine);

    if (!match?.groups) {
      if (JINA_INDEXED_LINE_PATTERN.test(trimmedLine)) {
        activeSnippetIndex = "";
        continue;
      }

      appendJinaSnippetLine(drafts, activeSnippetIndex, trimmedLine);
      continue;
    }

    const { field, index, value } = match.groups;
    if (!(field && index && value !== undefined)) {
      activeSnippetIndex = "";
      continue;
    }

    const draft = getJinaDraft(drafts, index);
    if (field === "Title") {
      draft.title = value;
      activeSnippetIndex = "";
      continue;
    }

    if (field === "URL Source") {
      draft.url = value;
      activeSnippetIndex = "";
      continue;
    }

    if (JINA_SEARCH_CONTENT_FIELDS.has(field)) {
      draft.snippet = value;
      activeSnippetIndex = index;
      continue;
    }

    activeSnippetIndex = "";
  }

  const results = Array.from(drafts.values())
    .map((draft) => normalizeResult(draft))
    .filter((result): result is ParsedResult => result !== null);

  return dedupeResults(results);
}

function createJinaSearchUrl(query: string, env: EnvironmentReader): string {
  const url = new URL(
    getBaseUrl("OPENSEARCH_JINA_SEARCH_URL", "https://s.jina.ai/", env)
  );
  const pathPrefix = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`;

  url.pathname = `${pathPrefix}${encodeURIComponent(query)}`;
  url.search = "";
  return url.toString();
}

function getJinaDraft(
  drafts: Map<string, JinaSearchDraft>,
  index: string
): JinaSearchDraft {
  const draft = drafts.get(index);
  if (draft) {
    return draft;
  }

  const nextDraft = { snippet: "", title: "", url: "" };
  drafts.set(index, nextDraft);
  return nextDraft;
}

function appendJinaSnippetLine(
  drafts: Map<string, JinaSearchDraft>,
  index: string,
  line: string
): void {
  if (!(index && line)) {
    return;
  }

  const draft = drafts.get(index);
  if (!draft) {
    return;
  }

  draft.snippet = draft.snippet ? `${draft.snippet} ${line}` : line;
}

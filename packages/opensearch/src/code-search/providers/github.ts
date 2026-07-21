import { readResponseJson } from "../../response-body.ts";
import type {
  CodeSearchMatch,
  CodeSearchOptions,
  CodeSearchResult,
} from "../types.ts";
import { formatSearchPattern, quoteSearchValue } from "./query.ts";

const GITHUB_SEARCH_URL = "https://api.github.com/search/code";
const GITHUB_TIMEOUT_MS = 8000;
const MAX_ITEMS = 20;

const textMatchMediaType = "application/vnd.github.text-match+json";

interface GitHubSearchItem {
  readonly html_url?: string;
  readonly path?: string;
  readonly repository?: { readonly full_name?: string };
  readonly text_matches?: readonly {
    readonly fragment?: string;
    readonly matches?: readonly {
      readonly indices?: readonly number[];
      readonly text?: string;
    }[];
  }[];
}

interface GitHubSearchResponse {
  readonly items?: readonly GitHubSearchItem[];
  readonly total_count?: number;
}

export async function searchGitHubCode(
  query: string,
  token: string,
  options: CodeSearchOptions = {}
): Promise<CodeSearchResult[]> {
  const url = new URL(buildGitHubCodeSearchUrl(query, options));
  url.searchParams.set(
    "per_page",
    String(Math.min(options.numResults ?? MAX_ITEMS, MAX_ITEMS))
  );

  const response = await fetch(url, {
    headers: {
      Accept: textMatchMediaType,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubSearchError(response.status);
  }

  const payload = (await readResponseJson(response)) as GitHubSearchResponse;
  return parseGitHubCodeSearchResponse(payload);
}

export class GitHubSearchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GitHub code search failed with HTTP ${status}`);
    this.name = "GitHubSearchError";
    this.status = status;
  }
}

export function parseGitHubCodeSearchResponse(
  payload: GitHubSearchResponse
): CodeSearchResult[] {
  return (payload.items ?? [])
    .filter((item) => item.path && item.repository?.full_name)
    .map((item) => {
      const matches: CodeSearchMatch[] = (item.text_matches ?? [])
        .filter((textMatch) => textMatch.fragment?.trim())
        .map((textMatch) => ({ snippet: textMatch.fragment?.trim() ?? "" }));
      return {
        matches: matches.length > 0 ? matches : [{ snippet: item.path ?? "" }],
        path: item.path ?? "",
        provider: "github" as const,
        repo: item.repository?.full_name ?? "",
        url: item.html_url ?? "",
      };
    });
}

export function buildGitHubCodeSearchUrl(
  query: string,
  options: CodeSearchOptions
): string {
  const qualifiers = [
    options.repo ? `repo:${quoteSearchValue(options.repo)}` : "",
    options.path ? `path:${quoteSearchValue(options.path)}` : "",
    options.language ? `language:${quoteSearchValue(options.language)}` : "",
  ].filter(Boolean);
  const pattern = formatSearchPattern(query, options.useRegexp);
  const url = new URL(GITHUB_SEARCH_URL);
  url.searchParams.set("q", [pattern, ...qualifiers].join(" "));
  return url.toString();
}

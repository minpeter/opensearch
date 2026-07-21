import { readResponseJson } from "../../response-body.ts";
import type { CodeSearchOptions, CodeSearchResult } from "../types.ts";
import { formatSearchPattern, quoteSearchValue } from "./query.ts";

const SOURCEGRAPH_GRAPHQL_URL = "https://sourcegraph.com/.api/graphql";
const SOURCEGRAPH_TIMEOUT_MS = 8000;

const SEARCH_QUERY = `query($q: String!) {
  search(query: $q) {
    results {
      matchCount
      results {
        __typename
        ... on FileMatch {
          repository { name }
          file { path }
          lineMatches { preview lineNumber }
        }
      }
    }
  }
}`;

interface SourcegraphLineMatch {
  readonly lineNumber?: number;
  readonly preview?: string;
}

interface SourcegraphFileMatch {
  readonly __typename?: string;
  readonly file?: { readonly path?: string };
  readonly lineMatches?: readonly SourcegraphLineMatch[];
  readonly repository?: { readonly name?: string };
}

interface SourcegraphSearchPayload {
  readonly data?: {
    readonly search?: {
      readonly results?: {
        readonly matchCount?: number;
        readonly results?: readonly SourcegraphFileMatch[];
      };
    };
  };
  readonly errors?: readonly { readonly message?: string }[];
}

export async function searchSourcegraphCode(
  query: string,
  options: CodeSearchOptions = {},
  token?: string
): Promise<CodeSearchResult[]> {
  const sourcegraphQuery = buildSourcegraphQuery(query, options);

  const response = await fetch(SOURCEGRAPH_GRAPHQL_URL, {
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: { q: sourcegraphQuery },
    }),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `token ${token}` } : {}),
    },
    method: "POST",
    signal: AbortSignal.timeout(SOURCEGRAPH_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new SourcegraphSearchError(response.status);
  }

  const payload = (await readResponseJson(
    response
  )) as SourcegraphSearchPayload;
  const message = payload.errors?.[0]?.message;
  if (message) {
    throw new SourcegraphSearchError(400, message);
  }

  return parseSourcegraphSearchResponse(payload);
}

export class SourcegraphSearchError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Sourcegraph search failed with HTTP ${status}`);
    this.name = "SourcegraphSearchError";
    this.status = status;
  }
}

export function buildSourcegraphQuery(
  query: string,
  options: CodeSearchOptions
): string {
  const pattern = formatSearchPattern(query, options.useRegexp);
  const parts = [
    pattern,
    options.repo ? `repo:${quoteSearchValue(options.repo)}` : "",
    options.path ? `file:${quoteSearchValue(options.path)}` : "",
    options.language ? `lang:${quoteSearchValue(options.language)}` : "",
    `count:${options.numResults ?? 10}`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function parseSourcegraphSearchResponse(
  payload: SourcegraphSearchPayload
): CodeSearchResult[] {
  const matches = payload.data?.search?.results?.results ?? [];
  return matches
    .filter(
      (match) =>
        match.__typename === "FileMatch" &&
        match.repository?.name &&
        match.file?.path
    )
    .map((match) => {
      const repo = match.repository?.name ?? "";
      const path = match.file?.path ?? "";
      return {
        matches: (match.lineMatches ?? [])
          .filter((line) => line.preview?.trim())
          .map((line) => ({
            lineStart: line.lineNumber,
            snippet: line.preview?.trim() ?? "",
          })),
        path,
        provider: "sourcegraph" as const,
        repo,
        url: `https://sourcegraph.com/${repo}/-/blob/${path}`,
      };
    });
}

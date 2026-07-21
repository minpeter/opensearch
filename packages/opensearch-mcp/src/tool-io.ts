import {
  CODE_SEARCH_PROVIDER_NAMES,
  type CodeSearchOptions,
  type CodeSearchResult,
  type FetchResult,
} from "@minpeter/opensearch";
import { z } from "zod";

const textContentType = "text" as const;
const MAX_FETCH_URLS = 10;
const DEFAULT_CODE_SEARCH_RESULT_COUNT = 10;
const DEFAULT_SEARCH_RESULT_COUNT = 5;
const MAX_CODE_SEARCH_RESULTS = 30;
const MAX_SEARCH_RESULTS = 15;

const searchResultCountSchema = z.int().positive().max(MAX_SEARCH_RESULTS);
const codeSearchResultCountSchema = z
  .int()
  .positive()
  .max(MAX_CODE_SEARCH_RESULTS);

export interface SearchToolResultItem {
  engine: string;
  snippet: string;
  title: string;
  url: string;
}

export const codeSearchInputSchema = z.object({
  language: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Programming language filter, for example TypeScript or Go."),
  numResults: codeSearchResultCountSchema
    .optional()
    .describe(
      "Maximum file-level results to return (default: 10, range: 1-30)."
    ),
  path: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("File path or provider-supported path pattern."),
  query: z
    .string()
    .trim()
    .min(1)
    .describe("Code, symbol, API, error text, or regular-expression query."),
  repo: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Repository filter, for example owner/repo."),
  sources: z
    .array(z.enum(CODE_SEARCH_PROVIDER_NAMES))
    .min(1)
    .optional()
    .describe("Providers to query; defaults to every configured provider."),
  useRegexp: z
    .boolean()
    .optional()
    .describe("Treat query as a regular expression where supported."),
});

export type CodeSearchInput = z.infer<typeof codeSearchInputSchema>;

export function getCodeSearchOptions(
  input: CodeSearchInput
): CodeSearchOptions {
  return {
    ...(input.language ? { language: input.language } : {}),
    numResults: input.numResults ?? DEFAULT_CODE_SEARCH_RESULT_COUNT,
    ...(input.path ? { path: input.path } : {}),
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.sources ? { sources: input.sources } : {}),
    ...(input.useRegexp === undefined ? {} : { useRegexp: input.useRegexp }),
  };
}

export function createCodeSearchToolResult(
  results: readonly CodeSearchResult[]
) {
  return {
    content: results.map((result) => ({
      text: formatCodeSearchResult(result),
      type: textContentType,
    })),
  };
}

function formatCodeSearchResult(result: CodeSearchResult): string {
  const metadata = [
    `Repository: ${result.repo}`,
    `Path: ${result.path}`,
    `URL: ${result.url}`,
    `Provider: ${result.provider}`,
    ...(result.language ? [`Language: ${result.language}`] : []),
    ...(result.license ? [`License: ${result.license}`] : []),
  ];
  const matches = result.matches.flatMap((match) => {
    const lineLabel = formatLineLabel(match.lineStart, match.lineEnd);
    return ["", ...(lineLabel ? [lineLabel] : []), match.snippet];
  });
  return [...metadata, ...matches].join("\n");
}

function formatLineLabel(
  lineStart: number | undefined,
  lineEnd: number | undefined
): string | undefined {
  if (lineStart === undefined) {
    return;
  }
  return lineEnd && lineEnd !== lineStart
    ? `Lines ${lineStart}-${lineEnd}:`
    : `Line ${lineStart}:`;
}

export const webSearchInputSchema = z.object({
  max_results: searchResultCountSchema
    .optional()
    .describe(
      "Backward-compatible alias for numResults. Number of search results to return (default: 5, range: 1-15)."
    ),
  numResults: searchResultCountSchema
    .optional()
    .describe("Number of search results to return (default: 5, range: 1-15)."),
  query: z
    .string()
    .describe(
      "Natural language search query. Describe the ideal page, not just keywords."
    ),
});

export const webFetchInputSchema = z.object({
  maxCharacters: z
    .int()
    .positive()
    .optional()
    .describe(
      "Maximum characters to extract per page (must be a positive number, default: 12000)."
    ),
  urls: z
    .array(z.url())
    .min(1)
    .max(MAX_FETCH_URLS)
    .describe("URLs to read. Batch multiple URLs in one call."),
});

export function createSearchContent(
  query: string,
  results: SearchToolResultItem[]
): string {
  const lines = results.map((result) =>
    [
      `Title: ${result.title}`,
      `URL: ${result.url}`,
      `Highlights: ${result.snippet}`,
      `Source: ${result.engine}`,
    ].join("\n")
  );

  return `Returned ${results.length} search results for "${query}".\n\n${lines.join("\n\n")}`;
}

export function createSearchToolResult(
  query: string,
  results: SearchToolResultItem[]
) {
  return {
    content: [
      { text: createSearchContent(query, results), type: textContentType },
    ],
  };
}

export function getSearchResultCount(
  input: z.infer<typeof webSearchInputSchema>
): number {
  return input.numResults ?? input.max_results ?? DEFAULT_SEARCH_RESULT_COUNT;
}

export function getFetchMaxCharacters(
  input: z.infer<typeof webFetchInputSchema>
): number | undefined {
  return input.maxCharacters;
}

function createFetchContentBlock(result: FetchResult): string {
  const title = result.title || result.url;

  return `Title: ${title}\nURL: ${result.url}\nLength: ${result.length}\n\n${result.content}`;
}

export function createFetchToolResult(results: FetchResult | FetchResult[]) {
  const normalizedResults = Array.isArray(results) ? results : [results];
  const [firstResult] = normalizedResults;

  if (!firstResult) {
    throw new Error("Fetch returned no results");
  }

  if (normalizedResults.length === 1) {
    return {
      content: [
        {
          text: createFetchContentBlock(firstResult),
          type: textContentType,
        },
      ],
    };
  }

  return {
    content: [
      {
        text: `Fetched ${normalizedResults.length} URLs. Each block below contains source metadata followed by extracted markdown.`,
        type: textContentType,
      },
      ...normalizedResults.map((result) => ({
        text: createFetchContentBlock(result),
        type: textContentType,
      })),
    ],
  };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

export function createToolErrorResponse(
  toolName: string,
  action: string,
  error: unknown
) {
  const errorMessage = errorMessageOf(error);
  console.error(`[opensearch] ${toolName} failed: ${errorMessage}`);

  return {
    content: [
      { text: `${action} failed: ${errorMessage}`, type: textContentType },
    ],
    isError: true,
  };
}

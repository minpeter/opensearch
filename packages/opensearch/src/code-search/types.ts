import { z } from "zod";

export const CODE_SEARCH_PROVIDER_NAMES = [
  "exa-code",
  "github",
  "grep",
  "sourcegraph",
] as const;

export type CodeSearchProviderName =
  (typeof CODE_SEARCH_PROVIDER_NAMES)[number];

export const codeSearchMatchSchema = z.object({
  lineEnd: z.number().optional(),
  lineStart: z.number().optional(),
  snippet: z.string(),
});

export type CodeSearchMatch = z.infer<typeof codeSearchMatchSchema>;

export const codeSearchResultSchema = z.object({
  language: z.string().optional(),
  license: z.string().optional(),
  matches: z.array(codeSearchMatchSchema),
  path: z.string(),
  provider: z.enum(CODE_SEARCH_PROVIDER_NAMES),
  repo: z.string(),
  url: z.string(),
});

export type CodeSearchResult = z.infer<typeof codeSearchResultSchema>;

export const codeSearchResultsSchema = z.array(codeSearchResultSchema);

export interface CodeSearchOptions {
  /** Skip the response cache for this call. */
  readonly cache?: "bypass";
  /** Restrict matches to a programming language (provider-mapped). */
  readonly language?: string;
  /** Maximum file-level results returned. Defaults to 10. */
  readonly numResults?: number;
  /** Restrict matches to a file path or path pattern (provider-mapped). */
  readonly path?: string;
  /** Restrict matches to a repository (provider-mapped). */
  readonly repo?: string;
  /** Restrict which providers run. Defaults to all configured providers. */
  readonly sources?: readonly CodeSearchProviderName[];
  /** Treat the query as a regular expression where providers support it. */
  readonly useRegexp?: boolean;
}

export interface CodeSearchProvider {
  readonly name: CodeSearchProviderName;
  readonly search: (
    query: string,
    options: CodeSearchOptions
  ) => Promise<CodeSearchResult[]>;
}

export interface CodeSearchServiceOptions {
  readonly cache?: {
    readonly enabled?: boolean;
    readonly maxEntries?: number;
    readonly ttlMs?: number;
  };
  readonly githubToken?: string;
  readonly providers?: readonly CodeSearchProvider[];
  readonly sourcegraphToken?: string;
}

export interface CodeSearchService {
  codeSearch: (
    query: string,
    options?: CodeSearchOptions
  ) => Promise<CodeSearchResult[]>;
}

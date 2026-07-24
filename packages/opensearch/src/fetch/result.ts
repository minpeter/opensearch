import { z } from "zod";

export type FetchVerdict =
  | "strong_ok"
  | "weak_ok"
  | "challenge"
  | "blocked"
  | "auth_required"
  | "partial_metadata"
  | "sidecar"
  | "unknown";

export type FetchSource =
  | "local"
  | "public_api"
  | "exa_api"
  | "exa_mcp"
  | "tinyfish"
  | "firecrawl"
  | "jina"
  | "feed"
  | "media"
  | "metadata"
  | "cache"
  | "archive"
  | "sidecar"
  | "unknown";

export interface FetchAttemptTrace {
  readonly bodySize?: number;
  readonly elapsedMs?: number;
  readonly executor?: string;
  readonly name: string;
  readonly phase?: string;
  readonly profileUsed?: string;
  readonly reasons?: readonly string[];
  readonly source?: FetchSource;
  readonly status?: number;
  readonly summary?: string;
  readonly url?: string;
  readonly urlTransform?: string;
  readonly verdict?: FetchVerdict;
}

export interface FetchResult {
  readonly content: string;
  readonly length: number;
  readonly title: string;
  readonly url: string;
}

export const fetchResultSchema = z.object({
  content: z.string(),
  length: z.number(),
  title: z.string(),
  url: z.string(),
}) satisfies z.ZodType<FetchResult>;

export function createFetchResult(
  url: string,
  content: string,
  title = ""
): FetchResult {
  return {
    content,
    length: content.length,
    title,
    url,
  };
}

export function limitFetchResult(
  result: FetchResult,
  maxCharacters: number
): FetchResult {
  if (result.content.length <= maxCharacters) {
    return result;
  }

  return createFetchResult(
    result.url,
    result.content.slice(0, maxCharacters),
    result.title
  );
}

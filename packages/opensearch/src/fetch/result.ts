import { z } from "zod";

export const FETCH_VERDICTS = [
  "strong_ok",
  "weak_ok",
  "challenge",
  "blocked",
  "auth_required",
  "partial_metadata",
  "sidecar",
  "unknown",
] as const;

export const FETCH_SOURCES = [
  "local",
  "public_api",
  "exa_api",
  "exa_mcp",
  "tinyfish",
  "firecrawl",
  "jina",
  "feed",
  "media",
  "metadata",
  "cache",
  "archive",
  "sidecar",
  "unknown",
] as const;

export type FetchVerdict = (typeof FETCH_VERDICTS)[number];
export type FetchSource = (typeof FETCH_SOURCES)[number];

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

const fetchVerdictSchema = z.enum(FETCH_VERDICTS);
const fetchSourceSchema = z.enum(FETCH_SOURCES);

export const fetchAttemptTraceSchema = z.object({
  bodySize: z.number().int().optional(),
  elapsedMs: z.number().int().optional(),
  executor: z.string().optional(),
  name: z.string(),
  phase: z.string().optional(),
  profileUsed: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  source: fetchSourceSchema.optional(),
  status: z.number().int().optional(),
  summary: z.string().optional(),
  url: z.string().optional(),
  urlTransform: z.string().optional(),
  verdict: fetchVerdictSchema.optional(),
});

export const fetchResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  length: z.number(),
}) satisfies z.ZodType<FetchResult>;

export function createFetchResult(
  url: string,
  content: string,
  title = ""
): FetchResult {
  return {
    title,
    content,
    url,
    length: content.length,
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

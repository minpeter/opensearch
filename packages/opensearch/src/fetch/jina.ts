import { z } from "zod";
import {
  cancelResponseBody,
  ResponseSizeLimitError,
  readResponseText,
} from "../response-body.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { isChallengePage } from "./challenge.ts";
import { DEFAULT_MAX_DOWNLOAD_BYTES } from "./local-options.ts";

const JINA_TIMEOUT_MS = 10_000;

export const JINA_READER_MODES = [
  "text",
  "json",
  "html",
  "sse",
  "screenshot",
] as const;

export type JinaReaderMode = (typeof JINA_READER_MODES)[number];

export interface JinaReaderOptions {
  readonly cacheToleranceSeconds?: number;
  readonly cookies?: string;
  readonly maxResponseBytes?: number;
  readonly mode?: JinaReaderMode;
  readonly noCache?: boolean;
  readonly targetSelector?: string;
  readonly timeoutMs?: number;
  readonly withLinks?: boolean;
}

export interface JinaReaderResult {
  readonly alternates: readonly string[];
  readonly content: string;
  readonly mode: JinaReaderMode;
  readonly title?: string;
  readonly url?: string;
}

const jinaJsonSchema = z.object({
  data: z
    .object({
      content: z.string().optional(),
      description: z.string().optional(),
      external: z.unknown().optional(),
      title: z.string().optional(),
      url: z.string().optional(),
    })
    .passthrough(),
});

function readerUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function alternateUrls(external: unknown): string[] {
  if (!isRecord(external)) {
    return [];
  }
  const alternate = external.alternate;
  if (isRecord(alternate)) {
    return Object.values(alternate).flatMap((value) => {
      if (isRecord(value)) {
        return stringArray(value.url ?? value.href);
      }
      return stringArray(value);
    });
  }
  return stringArray(alternate);
}

function buildHeaders(options: JinaReaderOptions): Record<string, string> {
  const mode = options.mode ?? "text";
  const headers: Record<string, string> = {
    "User-Agent": getRandomUserAgent(),
  };
  if (mode === "json") {
    headers.Accept = "application/json";
  } else if (mode === "sse") {
    headers.Accept = "text/event-stream";
  }
  if (mode === "html") {
    headers["X-Respond-With"] = "html";
  } else if (mode === "screenshot") {
    headers["X-Respond-With"] = "screenshot";
  }
  if (options.targetSelector) {
    headers["X-Target-Selector"] = options.targetSelector;
  }
  if (options.noCache) {
    headers["X-No-Cache"] = "true";
  }
  if (options.cacheToleranceSeconds !== undefined) {
    headers["X-Cache-Tolerance"] = String(options.cacheToleranceSeconds);
  }
  if (options.withLinks) {
    headers["X-With-Links"] = "true";
  }
  if (options.cookies) {
    headers["X-Set-Cookie"] = options.cookies;
  }
  return headers;
}

function resultFromText(
  text: string,
  mode: JinaReaderMode
): JinaReaderResult | null {
  if (!(text.length > 0) || isChallengePage(text)) {
    return null;
  }
  return { alternates: [], content: text, mode };
}

function resultFromJson(text: string): JinaReaderResult | null {
  const parsed = jinaJsonSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return null;
  }
  const content =
    parsed.data.data.content ?? parsed.data.data.description ?? "";
  if (!(content.length > 0) || isChallengePage(content)) {
    return null;
  }
  return {
    alternates: alternateUrls(parsed.data.data.external),
    content,
    mode: "json",
    ...(parsed.data.data.title ? { title: parsed.data.data.title } : {}),
    ...(parsed.data.data.url ? { url: parsed.data.data.url } : {}),
  };
}

export async function fetchJinaReader(
  url: string,
  options: JinaReaderOptions = {}
): Promise<JinaReaderResult | null> {
  const mode = options.mode ?? "text";
  try {
    const response = await fetch(readerUrl(url), {
      headers: buildHeaders(options),
      signal: AbortSignal.timeout(options.timeoutMs ?? JINA_TIMEOUT_MS),
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      return null;
    }
    const text = await readResponseText(
      response,
      options.maxResponseBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
    );
    return mode === "json" ? resultFromJson(text) : resultFromText(text, mode);
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      throw error;
    }
    return null;
  }
}

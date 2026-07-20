import { execFile } from "node:child_process";
import { createFetchResult } from "../fetch/result.ts";
import type { FetchResult } from "../fetch.ts";

const DEFAULT_YT_DLP_TIMEOUT_MS = 15_000;
const YT_DLP_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface YtDlpRunOptions {
  readonly timeoutMs: number;
}

export interface YtDlpRunResult {
  readonly stdout: string;
}

export type YtDlpRunner = (
  args: readonly string[],
  options: YtDlpRunOptions
) => Promise<YtDlpRunResult>;

export interface ExtractMediaMetadataOptions {
  readonly runner?: YtDlpRunner;
  readonly timeoutMs?: number;
}

interface YtDlpMetadata {
  readonly description?: string;
  readonly duration?: number;
  readonly extractor?: string;
  readonly tags?: readonly string[];
  readonly title?: string;
  readonly uploader?: string;
  readonly viewCount?: number;
  readonly webpageUrl?: string;
}

interface ErrorWithCode {
  readonly code?: string;
  readonly message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArrayValue(
  record: Record<string, unknown>,
  key: string
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string"
  );
  return strings.length > 0 ? strings : undefined;
}

function parseYtDlpMetadata(stdout: string): YtDlpMetadata | null {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) {
    return null;
  }

  return {
    description: stringValue(parsed, "description"),
    duration: numberValue(parsed, "duration"),
    extractor: stringValue(parsed, "extractor"),
    tags: stringArrayValue(parsed, "tags"),
    title: stringValue(parsed, "title"),
    uploader: stringValue(parsed, "uploader"),
    viewCount: numberValue(parsed, "view_count"),
    webpageUrl: stringValue(parsed, "webpage_url"),
  };
}

function markdownLine(
  label: string,
  value: number | string | undefined
): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  return `- ${label}: ${value}`;
}

function createMediaResult(
  requestedUrl: string,
  metadata: YtDlpMetadata
): FetchResult {
  const canonicalUrl = metadata.webpageUrl ?? requestedUrl;
  const title = metadata.title ?? canonicalUrl;
  const lines = [
    `# ${title}`,
    "",
    markdownLine("Uploader", metadata.uploader),
    markdownLine("Duration", metadata.duration),
    markdownLine("Views", metadata.viewCount),
    markdownLine("Extractor", metadata.extractor),
    metadata.tags ? `- Tags: ${metadata.tags.join(", ")}` : null,
    "",
    metadata.description,
  ].filter((line): line is string => line !== null && line !== undefined);
  const content = lines.join("\n");

  return createFetchResult(canonicalUrl, content, title);
}

function createUnsupportedDependencyResult(
  url: string,
  message: string
): FetchResult {
  const content = `unsupported_dependency: ${message}`;
  return createFetchResult(url, content, "Media metadata unavailable");
}

function isMissingYtDlp(error: unknown): boolean {
  return isRecord(error) && (error as ErrorWithCode).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "yt-dlp failed";
}

const defaultYtDlpRunner: YtDlpRunner = (
  args: readonly string[],
  options: YtDlpRunOptions
) =>
  new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [...args],
      {
        maxBuffer: YT_DLP_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout });
      }
    );
  });

export async function extractMediaMetadata(
  url: string,
  options: ExtractMediaMetadataOptions = {}
): Promise<FetchResult | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_YT_DLP_TIMEOUT_MS;
  const runner = options.runner ?? defaultYtDlpRunner;

  try {
    const { stdout } = await runner(["--dump-json", url], { timeoutMs });
    const metadata = parseYtDlpMetadata(stdout);
    return metadata ? createMediaResult(url, metadata) : null;
  } catch (error) {
    if (isMissingYtDlp(error)) {
      return createUnsupportedDependencyResult(url, "yt-dlp is not installed");
    }

    throw new Error(errorMessage(error), { cause: error });
  }
}

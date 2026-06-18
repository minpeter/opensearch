import { z } from "zod";
import type { FetchSource } from "./result.ts";

const ARCHIVE_TODAY_DOMAINS = [
  "archive.ph",
  "archive.is",
  "archive.md",
  "archive.vn",
  "archive.li",
] as const;

const WAYBACK_AVAILABLE_ENDPOINT = "https://archive.org/wayback/available";
const WAYBACK_CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";

type ArchiveCandidateType = "archive" | "cache";

export interface ArchiveCandidate {
  readonly name: string;
  readonly source: FetchSource;
  readonly type: ArchiveCandidateType;
  readonly url: string;
}

export interface ArchiveFetchResult {
  readonly candidate: ArchiveCandidate;
  readonly response: Response;
}

const waybackAvailableSchema = z.object({
  archived_snapshots: z
    .object({
      closest: z
        .object({
          available: z.boolean().optional(),
          url: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const waybackCdxSchema = z.array(z.array(z.string()));

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function ampCacheUrl(rawUrl: string): string | null {
  const url = parseHttpUrl(rawUrl);
  if (!url) {
    return null;
  }
  const domain = url.hostname.replaceAll(".", "-");
  const securePrefix = url.protocol === "https:" ? "/c/s" : "/c";
  return `https://${domain}.cdn.ampproject.org${securePrefix}/${url.host}${url.pathname}${url.search}`;
}

export function archiveTodayUrls(rawUrl: string): string[] {
  const url = parseHttpUrl(rawUrl);
  if (!url) {
    return [];
  }
  return ARCHIVE_TODAY_DOMAINS.map(
    (domain) => `https://${domain}/newest/${url.toString()}`
  );
}

export function waybackAvailabilityUrl(rawUrl: string): string | null {
  const url = parseHttpUrl(rawUrl);
  if (!url) {
    return null;
  }
  const endpoint = new URL(WAYBACK_AVAILABLE_ENDPOINT);
  endpoint.searchParams.set("url", url.toString());
  return endpoint.toString();
}

export function waybackCdxUrl(rawUrl: string): string | null {
  const url = parseHttpUrl(rawUrl);
  if (!url) {
    return null;
  }
  const endpoint = new URL(WAYBACK_CDX_ENDPOINT);
  endpoint.searchParams.set("url", url.toString());
  endpoint.searchParams.set("output", "json");
  endpoint.searchParams.set("fl", "timestamp,statuscode,original");
  endpoint.searchParams.set("filter", "statuscode:200");
  endpoint.searchParams.set("limit", "1");
  endpoint.searchParams.set("sort", "reverse");
  return endpoint.toString();
}

function archiveCandidate(
  name: string,
  url: string,
  source: FetchSource,
  type: ArchiveCandidateType
): ArchiveCandidate {
  return { name, source, type, url };
}

export function staticArchiveCandidates(rawUrl: string): ArchiveCandidate[] {
  const amp = ampCacheUrl(rawUrl);
  return [
    ...(amp ? [archiveCandidate("cache:amp", amp, "cache", "cache")] : []),
    ...archiveTodayUrls(rawUrl).map((url, index) =>
      archiveCandidate(
        `archive:today:${ARCHIVE_TODAY_DOMAINS[index] ?? "unknown"}`,
        url,
        "archive",
        "archive"
      )
    ),
  ];
}

async function waybackAvailableCandidate(
  rawUrl: string
): Promise<ArchiveCandidate | null> {
  const endpoint = waybackAvailabilityUrl(rawUrl);
  if (!endpoint) {
    return null;
  }
  const response = await fetch(endpoint);
  if (!response?.ok) {
    return null;
  }
  const parsed = waybackAvailableSchema.safeParse(await response.json());
  const snapshot = parsed.success
    ? parsed.data.archived_snapshots?.closest
    : null;
  return snapshot?.available && snapshot.url
    ? archiveCandidate(
        "archive:wayback:available",
        snapshot.url,
        "archive",
        "archive"
      )
    : null;
}

async function waybackCdxCandidate(
  rawUrl: string
): Promise<ArchiveCandidate | null> {
  const endpoint = waybackCdxUrl(rawUrl);
  if (!endpoint) {
    return null;
  }
  const response = await fetch(endpoint);
  if (!response?.ok) {
    return null;
  }
  const parsed = waybackCdxSchema.safeParse(await response.json());
  if (!(parsed.success && parsed.data.length > 1)) {
    return null;
  }
  const [timestamp, , original] = parsed.data[1] ?? [];
  if (!(timestamp && original)) {
    return null;
  }
  return archiveCandidate(
    "archive:wayback:cdx",
    `https://web.archive.org/web/${timestamp}/${original}`,
    "archive",
    "archive"
  );
}

async function dynamicArchiveCandidates(
  rawUrl: string
): Promise<ArchiveCandidate[]> {
  const out: ArchiveCandidate[] = [];
  const available = await waybackAvailableCandidate(rawUrl);
  if (available) {
    out.push(available);
  }
  const cdx = await waybackCdxCandidate(rawUrl);
  if (cdx) {
    out.push(cdx);
  }
  return out;
}

export async function archiveCandidates(
  rawUrl: string
): Promise<ArchiveCandidate[]> {
  const candidates = [
    ...staticArchiveCandidates(rawUrl),
    ...(await dynamicArchiveCandidates(rawUrl)),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });
}

export async function fetchArchiveFallback(
  rawUrl: string
): Promise<ArchiveFetchResult | null> {
  for (const candidate of staticArchiveCandidates(rawUrl)) {
    try {
      const response = await fetch(candidate.url);
      if (response?.ok) {
        return { candidate, response };
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  for (const candidate of await dynamicArchiveCandidates(rawUrl)) {
    try {
      const response = await fetch(candidate.url);
      if (response?.ok) {
        return { candidate, response };
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  return null;
}

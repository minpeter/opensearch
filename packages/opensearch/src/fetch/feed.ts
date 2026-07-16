import { load } from "cheerio";
import type { FetchResult } from "../fetch.ts";
import { cancelResponseBody, readResponseText } from "../response-body.ts";
import { type FeedDraft, type FeedEntry, parseFeedXml } from "./feed-parser.ts";
import { DEFAULT_MAX_DOWNLOAD_BYTES } from "./local-options.ts";
import { createFetchResult } from "./result.ts";
import { transformedUrlAttempts } from "./url-transforms.ts";

const FEED_CONTENT_TYPES = [
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
] as const;
const FEED_TRANSFORM_NAMES = new Set([
  "rss_path",
  "feed_path",
  "atom_xml_path",
  "rss_xml_path",
  "index_xml_path",
]);

interface FeedCandidate {
  readonly name: string;
  readonly url: string;
}

export interface FeedDiscoveryOptions {
  readonly fetcher?: (url: string) => Promise<Response>;
  readonly html?: string;
  readonly includeTransforms?: boolean;
  readonly jinaAlternates?: readonly string[];
  readonly maxResponseBytes?: number;
}

function entryLine(entry: FeedEntry): string {
  const link = entry.link ? ` (${entry.link})` : "";
  const summary = entry.summary ? ` - ${entry.summary}` : "";
  return `- ${entry.title}${link}${summary}`;
}

function feedResult(url: string, draft: FeedDraft): FetchResult {
  const content = [
    `# ${draft.title}`,
    "",
    ...draft.entries.map(entryLine),
  ].join("\n");
  return createFetchResult(url, content, draft.title);
}

export function isFeedResponse(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return FEED_CONTENT_TYPES.some((type) => normalized.includes(type));
}

export function parseFeed(
  url: string,
  xml: string,
  _name = "feed:parse"
): FetchResult | null {
  const draft = parseFeedXml(xml);
  return draft ? feedResult(url, draft) : null;
}

function feedTransformCandidates(rawUrl: string): FeedCandidate[] {
  return transformedUrlAttempts(rawUrl)
    .filter((attempt) => FEED_TRANSFORM_NAMES.has(attempt.name))
    .map((attempt) => ({
      name: `feed:transform:${attempt.name}`,
      url: attempt.url,
    }));
}

function htmlAlternateCandidates(
  rawUrl: string,
  html: string
): FeedCandidate[] {
  const $ = load(html);
  return $("link[rel~='alternate']")
    .toArray()
    .flatMap((node) => {
      const $node = $(node);
      const type = ($node.attr("type") ?? "").toLowerCase();
      const href = $node.attr("href")?.trim();
      if (!(href && isFeedResponse(type))) {
        return [];
      }
      return [
        {
          name: "feed:html-alternate",
          url: new URL(href, rawUrl).toString(),
        },
      ];
    });
}

export function discoverFeedCandidates(
  rawUrl: string,
  options: FeedDiscoveryOptions = {}
): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: FeedCandidate): void => {
    if (!seen.has(candidate.url)) {
      seen.add(candidate.url);
      out.push(candidate);
    }
  };

  if (options.html) {
    for (const candidate of htmlAlternateCandidates(rawUrl, options.html)) {
      add(candidate);
    }
  }
  for (const alternate of options.jinaAlternates ?? []) {
    add({
      name: "feed:jina-alternate",
      url: new URL(alternate, rawUrl).toString(),
    });
  }
  if (options.includeTransforms ?? true) {
    for (const candidate of feedTransformCandidates(rawUrl)) {
      add(candidate);
    }
  }
  return out;
}

export async function fetchDiscoveredFeed(
  rawUrl: string,
  options: FeedDiscoveryOptions = {}
): Promise<FetchResult | null> {
  const fetcher = options.fetcher ?? fetch;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  for (const candidate of discoverFeedCandidates(rawUrl, options)) {
    try {
      const response = await fetcher(candidate.url);
      if (!response.ok) {
        await cancelResponseBody(response);
        continue;
      }
      const parsed = parseFeed(
        candidate.url,
        await readResponseText(response, maxResponseBytes),
        candidate.name
      );
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }
  return null;
}

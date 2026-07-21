import { type CheerioAPI, load } from "cheerio";

const MAX_FEED_ENTRIES = 5;

export interface FeedEntry {
  readonly link?: string;
  readonly summary?: string;
  readonly title: string;
}

export interface FeedDraft {
  readonly entries: readonly FeedEntry[];
  readonly title: string;
}

interface CheerioSelection {
  attr: (name: string) => string | undefined;
  first: () => CheerioSelection;
  text: () => string;
}

function text($node: CheerioSelection): string {
  return $node.first().text().trim();
}

function attr($node: CheerioSelection, name: string): string | undefined {
  const value = $node.first().attr(name)?.trim();
  return value || undefined;
}

function feedEntry(
  title: string,
  link: string | undefined,
  summary: string | undefined
): FeedEntry {
  return {
    ...(link ? { link } : {}),
    ...(summary ? { summary } : {}),
    title,
  };
}

function parseRss($: CheerioAPI): FeedDraft | null {
  const title = text($("channel > title"));
  const entries = $("channel > item")
    .toArray()
    .map((item) => {
      const $item = $(item);
      const itemTitle = text($item.find("title"));
      if (!itemTitle) {
        return null;
      }
      return feedEntry(
        itemTitle,
        text($item.find("link")) || undefined,
        text($item.find("description")) || undefined
      );
    })
    .filter((entry): entry is FeedEntry => entry !== null)
    .slice(0, MAX_FEED_ENTRIES);

  return title && entries.length > 0 ? { entries, title } : null;
}

function parseAtom($: CheerioAPI): FeedDraft | null {
  const title = text($("feed > title"));
  const entries = $("feed > entry")
    .toArray()
    .map((entry) => {
      const $entry = $(entry);
      const entryTitle = text($entry.find("title"));
      if (!entryTitle) {
        return null;
      }
      return feedEntry(
        entryTitle,
        attr($entry.find("link[rel='alternate']"), "href") ??
          attr($entry.find("link").first(), "href"),
        text($entry.find("summary")) ||
          text($entry.find("content")) ||
          undefined
      );
    })
    .filter((entry): entry is FeedEntry => entry !== null)
    .slice(0, MAX_FEED_ENTRIES);

  return title && entries.length > 0 ? { entries, title } : null;
}

export function parseFeedXml(xml: string): FeedDraft | null {
  const $ = load(xml, { xmlMode: true });
  return parseRss($) ?? parseAtom($);
}

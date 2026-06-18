import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const HN_ID_RADIX = 10;
const MAX_HN_STORIES = 10;
const DIGITS_REGEX = /^\d+$/;

const hnItemSchema = z.object({
  by: z.string().optional(),
  descendants: z.number().optional(),
  score: z.number().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

const hnStoryIdsSchema = z.array(z.number().int());

const HN_LIST_ROUTES = {
  "/": {
    endpoint: "topstories",
    title: "Hacker News top stories",
    traceName: "public-api:hn:topstories",
  },
  "/ask": {
    endpoint: "askstories",
    title: "Hacker News ask stories",
    traceName: "public-api:hn:askstories",
  },
  "/best": {
    endpoint: "beststories",
    title: "Hacker News best stories",
    traceName: "public-api:hn:beststories",
  },
  "/news": {
    endpoint: "topstories",
    title: "Hacker News top stories",
    traceName: "public-api:hn:topstories",
  },
  "/newest": {
    endpoint: "newstories",
    title: "Hacker News new stories",
    traceName: "public-api:hn:newstories",
  },
  "/show": {
    endpoint: "showstories",
    title: "Hacker News show stories",
    traceName: "public-api:hn:showstories",
  },
} as const;

type HnListPath = keyof typeof HN_LIST_ROUTES;

async function fetchHackerNews(url: URL): Promise<FetchResult | null> {
  const listRoute = HN_LIST_ROUTES[url.pathname as HnListPath];
  if (listRoute) {
    return fetchHackerNewsList(url, listRoute);
  }

  const id = url.searchParams.get("id");
  if (!(id && DIGITS_REGEX.test(id))) {
    return null;
  }
  const json = await getJson(
    `https://hacker-news.firebaseio.com/v0/item/${Number.parseInt(id, HN_ID_RADIX)}.json`
  );
  const parsed = hnItemSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data;
  const parts: string[] = [];
  if (item.title) {
    parts.push(`# ${item.title}`);
  }
  if (item.by) {
    parts.push(`_by ${item.by}_`);
  }
  if (item.text) {
    parts.push(item.text);
  } else if (item.url) {
    parts.push(`Link: ${item.url}`);
  }
  const content = parts.join("\n\n");
  return content
    ? result(url.toString(), item.title ?? "", content, "public-api:hn:item")
    : null;
}

async function fetchHackerNewsList(
  url: URL,
  route: (typeof HN_LIST_ROUTES)[HnListPath]
): Promise<FetchResult | null> {
  const idsJson = await getJson(
    `https://hacker-news.firebaseio.com/v0/${route.endpoint}.json?limitToFirst=${MAX_HN_STORIES}&orderBy=%22%24key%22`
  );
  const ids = hnStoryIdsSchema.safeParse(idsJson);
  if (!(ids.success && ids.data.length > 0)) {
    return null;
  }

  const items = await Promise.all(
    ids.data
      .slice(0, MAX_HN_STORIES)
      .map((id) =>
        getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      )
  );
  const entries = items
    .map((item) => hnItemSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map(({ data }) => storyEntry(data))
    .filter(Boolean);
  const content =
    entries.length > 0 ? `## ${route.title}\n\n${entries.join("\n")}` : "";
  return content
    ? result(url.toString(), route.title, content, route.traceName)
    : null;
}

function storyEntry(item: z.infer<typeof hnItemSchema>): string {
  if (!item.title) {
    return "";
  }
  const details = [
    item.by && `by ${item.by}`,
    `${item.score ?? 0} points`,
    `${item.descendants ?? 0} comments`,
  ].filter(Boolean);
  return `- [${item.title}](${item.url ?? "#"})${details.length > 0 ? ` — ${details.join(" · ")}` : ""}`;
}

function result(
  url: string,
  title: string,
  content: string,
  _name?: string
): FetchResult {
  return createFetchResult(url, content, title);
}

function isHackerNews(url: URL): boolean {
  return (
    url.hostname === "news.ycombinator.com" &&
    (url.pathname === "/item" || url.pathname in HN_LIST_ROUTES)
  );
}

export const hackerNewsPublicApiRoute = {
  fetch: fetchHackerNews,
  match: isHackerNews,
  name: "hacker-news-item",
} satisfies PublicApiRoute;

import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const MAX_REDDIT_COMMENTS = 8;
const MAX_REDDIT_LISTING_ITEMS = 10;
const TRAILING_SLASH_REGEX = /\/$/;
const REDDIT_HOST_REGEX = /(^|\.)reddit\.com$/;
const SUBREDDIT_PATH_REGEX = /^\/r\/([^/]+)(?:\/(hot|new|top))?\/?$/;
const SUBREDDIT_SEARCH_REGEX = /^\/r\/([^/]+)\/search\/?$/;

const redditListingSchema = z.array(
  z.object({
    data: z.object({
      children: z.array(z.object({ data: z.record(z.string(), z.unknown()) })),
    }),
  })
);

const redditSubredditListingSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: z.record(z.string(), z.unknown()) })),
  }),
});

function redditField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

function redditNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === "number" ? value : 0;
}

function redditUrl(data: Record<string, unknown>): string {
  const url = redditField(data, "url");
  if (url) {
    return url;
  }
  const permalink = redditField(data, "permalink");
  return permalink ? `https://www.reddit.com${permalink}` : "";
}

function result(url: string, title: string, content: string): FetchResult {
  return createFetchResult(url, content, title);
}

function buildRedditMarkdown(parsed: z.infer<typeof redditListingSchema>): {
  title: string;
  content: string;
} {
  const post = parsed[0]?.data.children[0]?.data ?? {};
  const title = redditField(post, "title");
  const parts: string[] = [];
  if (title) {
    parts.push(`# ${title}`);
  }
  const selftext = redditField(post, "selftext");
  const link = redditField(post, "url");
  if (selftext) {
    parts.push(selftext);
  } else if (link) {
    parts.push(`Link: ${link}`);
  }

  const comments = (parsed[1]?.data.children ?? [])
    .map((child) => redditField(child.data, "body"))
    .filter(Boolean)
    .slice(0, MAX_REDDIT_COMMENTS);
  if (comments.length > 0) {
    parts.push(
      "## Comments",
      comments.map((comment) => `- ${comment}`).join("\n\n")
    );
  }

  return { content: parts.join("\n\n"), title };
}

function buildSubredditMarkdown(
  heading: string,
  parsed: z.infer<typeof redditSubredditListingSchema>
): string {
  const entries = parsed.data.children
    .map(({ data }) => {
      const title = redditField(data, "title");
      if (!title) {
        return "";
      }
      const author = redditField(data, "author");
      const details = [
        author && `by ${author}`,
        `${redditNumber(data, "score")} points`,
        `${redditNumber(data, "num_comments")} comments`,
      ].filter(Boolean);
      const link = redditUrl(data);
      return `- [${title}](${link || "#"})${details.length > 0 ? ` — ${details.join(" · ")}` : ""}`;
    })
    .filter(Boolean)
    .slice(0, MAX_REDDIT_LISTING_ITEMS);
  return entries.length > 0 ? `## ${heading}\n\n${entries.join("\n")}` : "";
}

async function fetchReddit(url: URL): Promise<FetchResult | null> {
  const listing = listingRequest(url);
  if (listing) {
    const json = await getJson(listing.apiUrl);
    const parsed = redditSubredditListingSchema.safeParse(json);
    if (!parsed.success) {
      return null;
    }
    const content = buildSubredditMarkdown(listing.heading, parsed.data);
    return content ? result(url.toString(), listing.title, content) : null;
  }

  const path = url.pathname.replace(TRAILING_SLASH_REGEX, "");
  const json = await getJson(`https://www.reddit.com${path}.json`);
  const parsed = redditListingSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const { title, content } = buildRedditMarkdown(parsed.data);
  return content ? result(url.toString(), title, content) : null;
}

interface RedditListingRequest {
  readonly apiUrl: string;
  readonly heading: string;
  readonly title: string;
}

function listingRequest(url: URL): RedditListingRequest | null {
  const searchMatch = url.pathname.match(SUBREDDIT_SEARCH_REGEX);
  if (searchMatch) {
    const subreddit = searchMatch[1] ?? "";
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!(subreddit && query)) {
      return null;
    }
    // biome-ignore assist/source/useSortedKeys: query param order matches Reddit API convention
    const params = new URLSearchParams({
      q: query,
      restrict_sr: "1",
      limit: String(MAX_REDDIT_LISTING_ITEMS),
    });
    return {
      apiUrl: `https://www.reddit.com/r/${subreddit}/search.json?${params.toString()}`,
      heading: `r/${subreddit} search`,
      title: `r/${subreddit} search "${query}"`,
    };
  }

  const listingMatch = url.pathname.match(SUBREDDIT_PATH_REGEX);
  if (!listingMatch) {
    return null;
  }
  const subreddit = listingMatch[1] ?? "";
  const sort = listingMatch[2] ?? "hot";
  if (!subreddit) {
    return null;
  }
  const label = `r/${subreddit} ${sort}`;
  return {
    apiUrl: `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${MAX_REDDIT_LISTING_ITEMS}`,
    heading: label,
    title: label,
  };
}

function isReddit(url: URL): boolean {
  return (
    REDDIT_HOST_REGEX.test(url.hostname) &&
    (url.pathname.includes("/comments/") ||
      SUBREDDIT_PATH_REGEX.test(url.pathname) ||
      SUBREDDIT_SEARCH_REGEX.test(url.pathname))
  );
}

export const redditPublicApiRoute = {
  fetch: fetchReddit,
  match: isReddit,
  name: "reddit-comments",
} satisfies PublicApiRoute;

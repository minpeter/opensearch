import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const BLUESKY_HOST = "bsky.app";
const PROFILE_PATH_REGEX = /^\/profile\/([^/]+)\/?$/;
const FEED_PATH_REGEX = /^\/profile\/([^/]+)\/feed\/?$/;
const FEED_LIMIT = 10;

const profileSchema = z.object({
  description: z.string().optional(),
  displayName: z.string().optional(),
  followersCount: z.number().optional(),
  handle: z.string(),
  postsCount: z.number().optional(),
});

const feedSchema = z.object({
  feed: z.array(
    z.object({
      post: z.object({
        author: z.object({
          displayName: z.string().optional(),
          handle: z.string(),
        }),
        likeCount: z.number().optional(),
        record: z.object({ text: z.string().optional() }).passthrough(),
        repostCount: z.number().optional(),
      }),
    })
  ),
});

function result(
  url: string,
  title: string,
  content: string,
  _name?: string
): FetchResult {
  return createFetchResult(url, content, title);
}

function fetchBluesky(url: URL): Promise<FetchResult | null> {
  const feedMatch = url.pathname.match(FEED_PATH_REGEX);
  if (feedMatch) {
    return fetchAuthorFeed(url, feedMatch[1] ?? "");
  }

  const profileMatch = url.pathname.match(PROFILE_PATH_REGEX);
  return profileMatch
    ? fetchProfile(url, profileMatch[1] ?? "")
    : Promise.resolve(null);
}

async function fetchProfile(
  url: URL,
  actor: string
): Promise<FetchResult | null> {
  if (!actor) {
    return null;
  }
  const endpoint = new URL(
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile"
  );
  endpoint.searchParams.set("actor", actor);
  const parsed = profileSchema.safeParse(await getJson(endpoint.toString()));
  if (!parsed.success) {
    return null;
  }
  const profile = parsed.data;
  const title = profile.displayName ?? profile.handle;
  const content = [
    `# ${title}`,
    `Handle: ${profile.handle}`,
    `Followers: ${profile.followersCount ?? 0}`,
    `Posts: ${profile.postsCount ?? 0}`,
    profile.description ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(url.toString(), title, content, "public-api:bluesky:profile");
}

async function fetchAuthorFeed(
  url: URL,
  actor: string
): Promise<FetchResult | null> {
  if (!actor) {
    return null;
  }
  const endpoint = new URL(
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
  );
  endpoint.searchParams.set("actor", actor);
  endpoint.searchParams.set("limit", String(FEED_LIMIT));
  const parsed = feedSchema.safeParse(await getJson(endpoint.toString()));
  if (!parsed.success) {
    return null;
  }
  const entries = parsed.data.feed
    .map(({ post }) => {
      const text = post.record.text?.trim();
      if (!text) {
        return "";
      }
      const author = post.author.displayName ?? post.author.handle;
      return `- ${text} — ${author} · ${post.likeCount ?? 0} likes · ${post.repostCount ?? 0} reposts`;
    })
    .filter(Boolean);
  const title = `Bluesky feed ${actor}`;
  const content =
    entries.length > 0 ? `## ${title}\n\n${entries.join("\n")}` : "";
  return content
    ? result(url.toString(), title, content, "public-api:bluesky:feed")
    : null;
}

function isBluesky(url: URL): boolean {
  return (
    url.hostname === BLUESKY_HOST &&
    (PROFILE_PATH_REGEX.test(url.pathname) ||
      FEED_PATH_REGEX.test(url.pathname))
  );
}

export const blueskyPublicApiRoute = {
  fetch: fetchBluesky,
  match: isBluesky,
  name: "bluesky",
} satisfies PublicApiRoute;

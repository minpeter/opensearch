import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const X_HOSTS = new Set(["x.com", "twitter.com"]);
const STATUS_PATH_REGEX = /^\/([^/]+)\/status\/(\d+)/;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_SPACE_REGEX = /\s+/g;
const HTML_ENTITIES = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
} as const;

const oembedSchema = z.object({
  author_name: z.string().optional(),
  author_url: z.string().optional(),
  html: z.string(),
});

function decodeHtml(text: string): string {
  return Object.entries(HTML_ENTITIES).reduce(
    (out, [entity, replacement]) => out.replaceAll(entity, replacement),
    text
  );
}

function textFromHtml(html: string): string {
  return decodeHtml(html.replace(HTML_TAG_REGEX, " "))
    .replace(HTML_SPACE_REGEX, " ")
    .trim();
}

function result(url: string, title: string, content: string): FetchResult {
  return createFetchResult(url, content, title);
}

async function fetchXTwitter(url: URL): Promise<FetchResult | null> {
  const match = url.pathname.match(STATUS_PATH_REGEX);
  if (!match) {
    return null;
  }
  const user = match[1] ?? "";
  const statusId = match[2] ?? "";
  const tweetUrl = `https://x.com/${user}/status/${statusId}`;
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("url", tweetUrl);
  const json = await getJson(endpoint.toString());
  const parsed = oembedSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const author = parsed.data.author_name ?? user;
  const body = textFromHtml(parsed.data.html);
  if (!body) {
    return null;
  }
  const parts = [`# ${author}`, body];
  if (parsed.data.author_url) {
    parts.push(`Author: ${parsed.data.author_url}`);
  }
  return result(url.toString(), author, parts.join("\n\n"));
}

function isXTwitter(url: URL): boolean {
  return X_HOSTS.has(url.hostname) && STATUS_PATH_REGEX.test(url.pathname);
}

export const xTwitterPublicApiRoute = {
  fetch: fetchXTwitter,
  match: isXTwitter,
  name: "x-twitter-oembed",
} satisfies PublicApiRoute;

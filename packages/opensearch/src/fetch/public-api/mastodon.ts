import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const PROFILE_PATH_REGEX = /^\/@([^/]+)\/?$/;
const STATUS_LIMIT = 5;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_SPACE_REGEX = /\s+/g;
const HTML_ENTITIES = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
} as const;

const accountSchema = z.object({
  acct: z.string(),
  display_name: z.string().optional(),
  followers_count: z.number().optional(),
  id: z.string(),
  note: z.string().optional(),
  statuses_count: z.number().optional(),
  username: z.string(),
});

const statusSchema = z.object({
  content: z.string(),
  created_at: z.string().optional(),
  favourites_count: z.number().optional(),
  reblogs_count: z.number().optional(),
  url: z.string().nullable().optional(),
});

const statusesSchema = z.array(statusSchema);

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

async function fetchMastodon(url: URL): Promise<FetchResult | null> {
  const match = url.pathname.match(PROFILE_PATH_REGEX);
  if (!match) {
    return null;
  }
  const username = match[1] ?? "";
  if (!username) {
    return null;
  }

  const lookupEndpoint = new URL(
    `https://${url.hostname}/api/v1/accounts/lookup`
  );
  lookupEndpoint.searchParams.set("acct", username);
  const accountParsed = accountSchema.safeParse(
    await getJson(lookupEndpoint.toString())
  );
  if (!accountParsed.success) {
    return null;
  }

  const statusesEndpoint = new URL(
    `https://${url.hostname}/api/v1/accounts/${accountParsed.data.id}/statuses`
  );
  statusesEndpoint.searchParams.set("limit", String(STATUS_LIMIT));
  const statusesParsed = statusesSchema.safeParse(
    await getJson(statusesEndpoint.toString())
  );
  if (!statusesParsed.success) {
    return null;
  }

  const account = accountParsed.data;
  const title = account.display_name || account.acct || account.username;
  const note = account.note ? textFromHtml(account.note) : "";
  const statusEntries = statusesParsed.data
    .map((status) => {
      const text = textFromHtml(status.content);
      if (!text) {
        return "";
      }
      const urlPart = status.url ? ` · ${status.url}` : "";
      return `- ${text} · ${status.favourites_count ?? 0} favorites · ${
        status.reblogs_count ?? 0
      } boosts${urlPart}`;
    })
    .filter(Boolean);
  const content = [
    `# ${title}`,
    `Account: @${account.acct}`,
    `Followers: ${account.followers_count ?? 0}`,
    `Statuses: ${account.statuses_count ?? 0}`,
    note,
    statusEntries.length > 0
      ? `## Recent statuses\n\n${statusEntries.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return result(url.toString(), title, content);
}

function isMastodon(url: URL): boolean {
  return PROFILE_PATH_REGEX.test(url.pathname);
}

export const mastodonPublicApiRoute = {
  fetch: fetchMastodon,
  match: isMastodon,
  name: "mastodon",
} satisfies PublicApiRoute;

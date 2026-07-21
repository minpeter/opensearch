import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson, getText } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const DEV_TO_HOST = "dev.to";
const LOBSTERS_HOST = "lobste.rs";
const V2EX_HOST = "www.v2ex.com";
const NAVER_FINANCE_HOST = "finance.naver.com";
const DEV_TO_TAG_REGEX = /^\/t\/([^/]+)\/?$/;
const LOBSTERS_TAG_REGEX = /^\/t\/([^/]+)\/?$/;
const NAVER_ITEM_PATH = "/item/main.naver";

const devToArticleSchema = z.array(
  z.object({
    public_reactions_count: z.number().optional(),
    reading_time_minutes: z.number().optional(),
    tag_list: z.array(z.string()).optional(),
    title: z.string(),
    url: z.string().optional(),
    user: z.object({ name: z.string().optional() }).optional(),
  })
);

const lobstersStorySchema = z.array(
  z.object({
    comment_count: z.number().optional(),
    score: z.number().optional(),
    short_id: z.string().optional(),
    submitter_user: z.string().optional(),
    tags: z.array(z.string()).optional(),
    title: z.string(),
    url: z.string().optional(),
  })
);

const v2exTopicSchema = z.array(
  z.object({
    member: z.object({ username: z.string().optional() }).optional(),
    replies: z.number().optional(),
    title: z.string(),
    url: z.string().optional(),
  })
);

function result(url: string, title: string, content: string): FetchResult {
  return createFetchResult(url, content, title);
}

async function fetchDevTo(url: URL): Promise<FetchResult | null> {
  const tag = url.pathname.match(DEV_TO_TAG_REGEX)?.[1];
  if (!tag) {
    return null;
  }
  const endpoint = new URL("https://dev.to/api/articles");
  endpoint.searchParams.set("tag", tag);
  endpoint.searchParams.set("per_page", "5");
  const parsed = devToArticleSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.length > 0)) {
    return null;
  }
  const entries = parsed.data.map((article) => {
    const author = article.user?.name ? ` · ${article.user.name}` : "";
    const tags = article.tag_list?.length
      ? ` · ${article.tag_list.join(", ")}`
      : "";
    const link = article.url ? ` · ${article.url}` : "";
    return `- ${article.title}${author} · ${article.public_reactions_count ?? 0} reactions · ${article.reading_time_minutes ?? 0} min${tags}${link}`;
  });
  const title = `dev.to ${tag}`;
  return result(url.toString(), title, `## ${title}\n\n${entries.join("\n")}`);
}

async function fetchLobsters(url: URL): Promise<FetchResult | null> {
  const endpoint = new URL("https://lobste.rs/hottest.json");
  const tag = url.pathname.match(LOBSTERS_TAG_REGEX)?.[1];
  if (tag) {
    endpoint.pathname = `/t/${tag}.json`;
  } else if (url.pathname.startsWith("/newest")) {
    endpoint.pathname = "/newest.json";
  } else if (!["/", "/hottest"].includes(url.pathname)) {
    return null;
  }
  const parsed = lobstersStorySchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.length > 0)) {
    return null;
  }
  const entries = parsed.data.map((story) => {
    const tags = story.tags?.length ? ` · ${story.tags.join(", ")}` : "";
    const link = story.url ? ` · ${story.url}` : "";
    return `- ${story.title} · ${story.score ?? 0} points · ${story.comment_count ?? 0} comments${tags}${link}`;
  });
  const title = tag ? `Lobsters ${tag}` : "Lobsters stories";
  return result(url.toString(), title, `## ${title}\n\n${entries.join("\n")}`);
}

async function fetchV2ex(url: URL): Promise<FetchResult | null> {
  if (!["/", "/hot"].includes(url.pathname)) {
    return null;
  }
  const parsed = v2exTopicSchema.safeParse(
    await getJson("https://www.v2ex.com/api/topics/hot.json")
  );
  if (!(parsed.success && parsed.data.length > 0)) {
    return null;
  }
  const entries = parsed.data.map((topic) => {
    const author = topic.member?.username ? ` · ${topic.member.username}` : "";
    const link = topic.url ? ` · ${topic.url}` : "";
    return `- ${topic.title}${author} · ${topic.replies ?? 0} replies${link}`;
  });
  return result(
    url.toString(),
    "V2EX hot topics",
    `## V2EX hot topics\n\n${entries.join("\n")}`
  );
}

async function fetchNaverFinance(url: URL): Promise<FetchResult | null> {
  const code = url.searchParams.get("code");
  if (!(url.pathname === NAVER_ITEM_PATH && code)) {
    return null;
  }
  const endpoint = new URL("https://api.finance.naver.com/siseJson.naver");
  endpoint.searchParams.set("symbol", code);
  endpoint.searchParams.set("requestType", "0");
  endpoint.searchParams.set("timeframe", "minute");
  endpoint.searchParams.set("count", "5");
  const body = await getText(endpoint.toString());
  if (!(body?.includes(code) || body?.includes("날짜"))) {
    return null;
  }
  const rows = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("["));
  if (rows.length === 0) {
    return null;
  }
  const title = `Naver Finance ${code}`;
  return result(url.toString(), title, `## ${title}\n\n${rows.join("\n")}`);
}

function isCommunityProvider(url: URL): boolean {
  return (
    url.hostname === DEV_TO_HOST ||
    url.hostname === LOBSTERS_HOST ||
    url.hostname === V2EX_HOST ||
    url.hostname === NAVER_FINANCE_HOST
  );
}

function fetchCommunityProvider(url: URL): Promise<FetchResult | null> {
  if (url.hostname === DEV_TO_HOST) {
    return fetchDevTo(url);
  }
  if (url.hostname === LOBSTERS_HOST) {
    return fetchLobsters(url);
  }
  if (url.hostname === V2EX_HOST) {
    return fetchV2ex(url);
  }
  if (url.hostname === NAVER_FINANCE_HOST) {
    return fetchNaverFinance(url);
  }
  return Promise.resolve(null);
}

export const communityProvidersPublicApiRoute = {
  fetch: fetchCommunityProvider,
  match: isCommunityProvider,
  name: "community-providers",
} satisfies PublicApiRoute;

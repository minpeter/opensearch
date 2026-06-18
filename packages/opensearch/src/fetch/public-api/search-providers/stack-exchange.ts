import { z } from "zod";
import { getJson } from "../http.ts";
import { queryValue, SEARCH_PATH, searchResult } from "./result.ts";

const STACK_EXCHANGE_HOSTS: ReadonlyMap<string, string> = new Map([
  ["stackoverflow.com", "stackoverflow"],
  ["superuser.com", "superuser"],
  ["serverfault.com", "serverfault"],
]);

const stackExchangeSearchSchema = z.object({
  items: z.array(
    z.object({
      answer_count: z.number().optional(),
      link: z.string().optional(),
      score: z.number().optional(),
      tags: z.array(z.string()).optional(),
      title: z.string(),
    })
  ),
});

export function isStackExchangeSearchProvider(url: URL): boolean {
  return url.pathname === SEARCH_PATH && STACK_EXCHANGE_HOSTS.has(url.hostname);
}

export async function fetchStackExchangeSearchProvider(url: URL) {
  const site = STACK_EXCHANGE_HOSTS.get(url.hostname);
  const query = queryValue(url);
  const tag = url.searchParams.get("tagged");
  if (!(site && (query || tag))) {
    return null;
  }
  const endpoint = new URL("https://api.stackexchange.com/2.3/search");
  endpoint.searchParams.set("order", "desc");
  endpoint.searchParams.set("sort", "votes");
  endpoint.searchParams.set("site", site);
  if (query) {
    endpoint.searchParams.set("intitle", query);
  }
  if (tag) {
    endpoint.searchParams.set("tagged", tag);
  }
  const parsed = stackExchangeSearchSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.items.length > 0)) {
    return null;
  }
  const entries = parsed.data.items.map((item) => {
    const tags = item.tags?.length ? ` · ${item.tags.join(", ")}` : "";
    const link = item.link ? ` · ${item.link}` : "";
    return `- ${item.title} · ${item.score ?? 0} score · ${item.answer_count ?? 0} answers${tags}${link}`;
  });
  const title = `${site} search ${query ?? tag}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:stack-exchange-search",
    "public-api:stack-exchange:search"
  );
}

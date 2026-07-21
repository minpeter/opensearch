import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const STACK_EXCHANGE_HOSTS: ReadonlyMap<string, string> = new Map([
  ["stackoverflow.com", "stackoverflow"],
  ["superuser.com", "superuser"],
  ["serverfault.com", "serverfault"],
]);
const QUESTION_PATH_REGEX = /^\/questions\/(\d+)/;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_SPACE_REGEX = /\s+/g;
const HTML_ENTITIES = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
} as const;

const answersSchema = z.object({
  items: z.array(
    z.object({
      body: z.string().optional(),
      is_accepted: z.boolean().optional(),
      link: z.string().optional(),
      owner: z
        .object({
          display_name: z.string().optional(),
        })
        .optional(),
      score: z.number().optional(),
    })
  ),
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

async function fetchStackExchange(url: URL): Promise<FetchResult | null> {
  const site = STACK_EXCHANGE_HOSTS.get(url.hostname);
  const match = url.pathname.match(QUESTION_PATH_REGEX);
  if (!(site && match)) {
    return null;
  }
  const questionId = match[1] ?? "";

  const endpoint = new URL(
    `https://api.stackexchange.com/2.3/questions/${questionId}/answers`
  );
  endpoint.searchParams.set("order", "desc");
  endpoint.searchParams.set("sort", "votes");
  endpoint.searchParams.set("site", site);
  endpoint.searchParams.set("filter", "withbody");
  const parsed = answersSchema.safeParse(await getJson(endpoint.toString()));
  if (!(parsed.success && parsed.data.items.length > 0)) {
    return null;
  }

  const entries = parsed.data.items
    .map((answer) => {
      const body = answer.body ? textFromHtml(answer.body) : "";
      if (!body) {
        return "";
      }
      const accepted = answer.is_accepted ? "accepted · " : "";
      const owner = answer.owner?.display_name ?? "unknown";
      const link = answer.link ? ` · ${answer.link}` : "";
      return `- ${accepted}${answer.score ?? 0} score · ${owner}: ${body}${link}`;
    })
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }

  const title = `${site} question ${questionId} answers`;
  return result(url.toString(), title, `## ${title}\n\n${entries.join("\n")}`);
}

function isStackExchange(url: URL): boolean {
  return (
    STACK_EXCHANGE_HOSTS.has(url.hostname) &&
    QUESTION_PATH_REGEX.test(url.pathname)
  );
}

export const stackExchangePublicApiRoute = {
  fetch: fetchStackExchange,
  match: isStackExchange,
  name: "stack-exchange",
} satisfies PublicApiRoute;

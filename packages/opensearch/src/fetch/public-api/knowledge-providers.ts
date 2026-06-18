import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { parseArxivEntries } from "./arxiv-xml.ts";
import { getJson, getText } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const ARXIV_HOST = "arxiv.org";
const OPEN_LIBRARY_ISBN_REGEX = /^\/isbn\/([^/]+)\/?$/;
const WIKIPEDIA_PAGE_REGEX = /^\/wiki\/(.+)$/;

const crossrefSchema = z.object({
  message: z.object({
    DOI: z.string().optional(),
    title: z.array(z.string()).optional(),
    URL: z.string().optional(),
    author: z
      .array(
        z.object({
          family: z.string().optional(),
          given: z.string().optional(),
        })
      )
      .optional(),
    "container-title": z.array(z.string()).optional(),
    issued: z
      .object({
        "date-parts": z.array(z.array(z.number())).optional(),
      })
      .optional(),
  }),
});

const openLibrarySchema = z.record(
  z.string(),
  z.object({
    authors: z.array(z.object({ name: z.string() })).optional(),
    number_of_pages: z.number().optional(),
    publish_date: z.string().optional(),
    title: z.string(),
    url: z.string().optional(),
  })
);

const wikipediaSummarySchema = z.object({
  content_urls: z
    .object({
      desktop: z.object({ page: z.string().optional() }).optional(),
    })
    .optional(),
  description: z.string().optional(),
  extract: z.string().optional(),
  title: z.string(),
});

function result(
  url: string,
  title: string,
  content: string,
  _profileUsed?: string,
  _name?: string
): FetchResult {
  return createFetchResult(url, content, title);
}

async function fetchArxiv(url: URL): Promise<FetchResult | null> {
  const query =
    url.searchParams.get("query") ?? url.searchParams.get("search_query");
  if (!(url.pathname.startsWith("/search") && query)) {
    return null;
  }
  const endpoint = new URL("https://export.arxiv.org/api/query");
  endpoint.searchParams.set("search_query", `all:${query}`);
  endpoint.searchParams.set("max_results", "5");
  endpoint.searchParams.set("sortBy", "submittedDate");
  endpoint.searchParams.set("sortOrder", "descending");
  const xml = await getText(endpoint.toString());
  if (!xml) {
    return null;
  }
  const entries = parseArxivEntries(xml);
  if (entries.length === 0) {
    return null;
  }
  const title = `arXiv search ${query}`;
  return result(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:arxiv",
    "public-api:arxiv:query"
  );
}

async function fetchCrossref(url: URL): Promise<FetchResult | null> {
  const doi = decodeURIComponent(url.pathname.slice(1));
  if (!doi) {
    return null;
  }
  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const parsed = crossrefSchema.safeParse(await getJson(endpoint));
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data.message;
  const title = item.title?.[0] ?? item.DOI ?? doi;
  const authors = item.author
    ?.map(({ family, given }) => [given, family].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const content = [
    `# ${title}`,
    item.DOI ? `DOI: ${item.DOI}` : "",
    authors ? `Authors: ${authors}` : "",
    item["container-title"]?.[0]
      ? `Container: ${item["container-title"][0]}`
      : "",
    year ? `Year: ${year}` : "",
    item.URL ? `URL: ${item.URL}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    title,
    content,
    "public-api:crossref",
    "public-api:crossref:doi"
  );
}

async function fetchOpenLibrary(url: URL): Promise<FetchResult | null> {
  const isbn = url.pathname.match(OPEN_LIBRARY_ISBN_REGEX)?.[1];
  if (!isbn) {
    return null;
  }
  const endpoint = new URL("https://openlibrary.org/api/books");
  endpoint.searchParams.set("bibkeys", `ISBN:${isbn}`);
  endpoint.searchParams.set("jscmd", "data");
  endpoint.searchParams.set("format", "json");
  const parsed = openLibrarySchema.safeParse(
    await getJson(endpoint.toString())
  );
  const book = parsed.success ? parsed.data[`ISBN:${isbn}`] : null;
  if (!book) {
    return null;
  }
  const content = [
    `# ${book.title}`,
    book.authors?.length
      ? `Authors: ${book.authors.map(({ name }) => name).join(", ")}`
      : "",
    book.publish_date ? `Published: ${book.publish_date}` : "",
    book.number_of_pages ? `Pages: ${book.number_of_pages}` : "",
    book.url ? `URL: ${book.url}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    book.title,
    content,
    "public-api:openlibrary",
    "public-api:openlibrary:isbn"
  );
}

async function fetchWikipedia(url: URL): Promise<FetchResult | null> {
  const title = url.pathname.match(WIKIPEDIA_PAGE_REGEX)?.[1];
  const language = url.hostname.split(".")[0];
  if (!(title && language)) {
    return null;
  }
  const endpoint = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${title}`;
  const parsed = wikipediaSummarySchema.safeParse(await getJson(endpoint));
  if (!parsed.success) {
    return null;
  }
  const page = parsed.data;
  const content = [
    `# ${page.title}`,
    page.description ?? "",
    page.extract ?? "",
    page.content_urls?.desktop?.page
      ? `URL: ${page.content_urls.desktop.page}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    page.title,
    content,
    "public-api:wikipedia",
    "public-api:wikipedia:summary"
  );
}

function isKnowledgeProvider(url: URL): boolean {
  return (
    url.hostname === ARXIV_HOST ||
    url.hostname === "doi.org" ||
    url.hostname === "openlibrary.org" ||
    url.hostname.endsWith(".wikipedia.org")
  );
}

function fetchKnowledgeProvider(url: URL): Promise<FetchResult | null> {
  if (url.hostname === ARXIV_HOST) {
    return fetchArxiv(url);
  }
  if (url.hostname === "doi.org") {
    return fetchCrossref(url);
  }
  if (url.hostname === "openlibrary.org") {
    return fetchOpenLibrary(url);
  }
  if (url.hostname.endsWith(".wikipedia.org")) {
    return fetchWikipedia(url);
  }
  return Promise.resolve(null);
}

export const knowledgeProvidersPublicApiRoute = {
  fetch: fetchKnowledgeProvider,
  match: isKnowledgeProvider,
  name: "knowledge-providers",
} satisfies PublicApiRoute;

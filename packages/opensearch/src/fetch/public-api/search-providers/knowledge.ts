import { z } from "zod";
import { getJson } from "../http.ts";
import { queryValue, SEARCH_PATH, searchResult } from "./result.ts";

const openLibrarySearchSchema = z.object({
  docs: z.array(
    z.object({
      author_name: z.array(z.string()).optional(),
      first_publish_year: z.number().optional(),
      title: z.string(),
    })
  ),
});

const crossrefSearchSchema = z.object({
  message: z.object({
    items: z.array(
      z.object({
        DOI: z.string().optional(),
        title: z.array(z.string()).optional(),
        URL: z.string().optional(),
      })
    ),
  }),
});

const wikipediaSearchSchema = z.tuple([
  z.string(),
  z.array(z.string()),
  z.array(z.string()),
  z.array(z.string()),
]);

async function fetchOpenLibrarySearch(url: URL) {
  const query = queryValue(url);
  if (!query) {
    return null;
  }
  const endpoint = new URL("https://openlibrary.org/search.json");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "5");
  const parsed = openLibrarySearchSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.docs.length > 0)) {
    return null;
  }
  const entries = parsed.data.docs.map((book) => {
    const authors = book.author_name?.length
      ? ` · ${book.author_name.join(", ")}`
      : "";
    const year = book.first_publish_year ? ` · ${book.first_publish_year}` : "";
    return `- ${book.title}${authors}${year}`;
  });
  const title = `OpenLibrary books ${query}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:openlibrary-search",
    "public-api:openlibrary:search"
  );
}

async function fetchCrossrefSearch(url: URL) {
  const query = queryValue(url);
  if (!query) {
    return null;
  }
  const endpoint = new URL("https://api.crossref.org/works");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("rows", "5");
  endpoint.searchParams.set("sort", "relevance");
  const parsed = crossrefSearchSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.message.items.length > 0)) {
    return null;
  }
  const entries = parsed.data.message.items.map((item) => {
    const title = item.title?.[0] ?? item.DOI ?? "Untitled";
    const doi = item.DOI ? ` · DOI: ${item.DOI}` : "";
    const link = item.URL ? ` · ${item.URL}` : "";
    return `- ${title}${doi}${link}`;
  });
  const title = `CrossRef works ${query}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:crossref-search",
    "public-api:crossref:search"
  );
}

async function fetchWikipediaSearch(url: URL) {
  const query = queryValue(url);
  const [language] = url.hostname.split(".");
  if (!(language && query)) {
    return null;
  }
  const endpoint = new URL(`https://${language}.wikipedia.org/w/api.php`);
  endpoint.searchParams.set("action", "opensearch");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("format", "json");
  const parsed = wikipediaSearchSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data[1].length > 0)) {
    return null;
  }
  const entries = parsed.data[1].map((entryTitle, index) => {
    const description = parsed.data[2][index]
      ? `: ${parsed.data[2][index]}`
      : "";
    const link = parsed.data[3][index] ? ` · ${parsed.data[3][index]}` : "";
    return `- ${entryTitle}${description}${link}`;
  });
  const title = `Wikipedia search ${query}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:wikipedia-search",
    "public-api:wikipedia:opensearch"
  );
}

export function isKnowledgeSearchProvider(url: URL): boolean {
  return (
    url.pathname === SEARCH_PATH &&
    (url.hostname === "openlibrary.org" ||
      url.hostname === "www.crossref.org" ||
      url.hostname.endsWith(".wikipedia.org"))
  );
}

export function fetchKnowledgeSearchProvider(url: URL) {
  if (url.hostname === "openlibrary.org") {
    return fetchOpenLibrarySearch(url);
  }
  if (url.hostname === "www.crossref.org") {
    return fetchCrossrefSearch(url);
  }
  return fetchWikipediaSearch(url);
}

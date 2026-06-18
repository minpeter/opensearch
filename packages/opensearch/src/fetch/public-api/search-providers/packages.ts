import { z } from "zod";
import { getJson } from "../http.ts";
import { queryValue, SEARCH_PATH, searchResult } from "./result.ts";

const GITHUB_HOST = "github.com";
const NPM_HOST = "www.npmjs.com";

const githubSearchSchema = z.object({
  items: z.array(
    z.object({
      description: z.string().nullable().optional(),
      full_name: z.string(),
      html_url: z.string(),
      stargazers_count: z.number().optional(),
    })
  ),
});

const npmSearchSchema = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        description: z.string().optional(),
        links: z.object({ npm: z.string().optional() }).optional(),
        name: z.string(),
        version: z.string().optional(),
      }),
    })
  ),
});

async function fetchGitHubSearch(url: URL) {
  const query = queryValue(url);
  if (!query) {
    return null;
  }
  const endpoint = new URL("https://api.github.com/search/repositories");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("sort", "stars");
  endpoint.searchParams.set("per_page", "5");
  const parsed = githubSearchSchema.safeParse(
    await getJson(endpoint.toString())
  );
  if (!(parsed.success && parsed.data.items.length > 0)) {
    return null;
  }
  const entries = parsed.data.items.map((repo) => {
    const desc = repo.description ? `: ${repo.description}` : "";
    return `- [${repo.full_name}](${repo.html_url}) · ${repo.stargazers_count ?? 0} stars${desc}`;
  });
  const title = `GitHub repositories ${query}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:github-search",
    "public-api:github:search"
  );
}

async function fetchNpmSearch(url: URL) {
  const query = queryValue(url);
  if (!query) {
    return null;
  }
  const endpoint = new URL("https://registry.npmjs.org/-/v1/search");
  endpoint.searchParams.set("text", query);
  endpoint.searchParams.set("size", "5");
  const parsed = npmSearchSchema.safeParse(await getJson(endpoint.toString()));
  if (!(parsed.success && parsed.data.objects.length > 0)) {
    return null;
  }
  const entries = parsed.data.objects.map(({ package: pkg }) => {
    const desc = pkg.description ? `: ${pkg.description}` : "";
    const link = pkg.links?.npm ? ` · ${pkg.links.npm}` : "";
    return `- ${pkg.name}@${pkg.version ?? "latest"}${desc}${link}`;
  });
  const title = `npm packages ${query}`;
  return searchResult(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:npm-search",
    "public-api:npm:search"
  );
}

export function isPackageSearchProvider(url: URL): boolean {
  return (
    url.pathname === SEARCH_PATH &&
    (url.hostname === GITHUB_HOST || url.hostname === NPM_HOST)
  );
}

export function fetchPackageSearchProvider(url: URL) {
  return url.hostname === GITHUB_HOST
    ? fetchGitHubSearch(url)
    : fetchNpmSearch(url);
}

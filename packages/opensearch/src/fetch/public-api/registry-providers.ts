import { z } from "zod";
import { createFetchResult, type FetchResult } from "../result.ts";
import { getJson } from "./http.ts";
import type { PublicApiRoute } from "./registry.ts";

const NPM_HOST = "www.npmjs.com";
const PYPI_HOST = "pypi.org";
const GITHUB_HOST = "github.com";
const WAYBACK_HOST = "web.archive.org";
const NPM_PACKAGE_REGEX = /^\/package\/([^/]+(?:\/[^/]+)?)\/?$/;
const PYPI_PROJECT_REGEX = /^\/project\/([^/]+)\/?$/;
const GITHUB_RELEASES_REGEX = /^\/([^/]+)\/([^/]+)\/releases\/?$/;
const WAYBACK_WEB_REGEX = /^\/web\/(?:\d+|\*)\/(.+)$/;

const npmPackageSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  version: z.string(),
});

const pypiPackageSchema = z.object({
  info: z.object({
    author: z.string().optional(),
    name: z.string(),
    summary: z.string().optional(),
    version: z.string(),
  }),
});

const githubReleasesSchema = z.array(
  z.object({
    html_url: z.string().optional(),
    name: z.string().nullable().optional(),
    prerelease: z.boolean().optional(),
    published_at: z.string().nullable().optional(),
    tag_name: z.string(),
  })
);

const waybackSchema = z.object({
  archived_snapshots: z
    .object({
      closest: z
        .object({
          available: z.boolean().optional(),
          status: z.string().optional(),
          timestamp: z.string().optional(),
          url: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
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

async function fetchNpm(url: URL): Promise<FetchResult | null> {
  const packageName = url.pathname.match(NPM_PACKAGE_REGEX)?.[1];
  if (!packageName) {
    return null;
  }
  const endpoint = `https://registry.npmjs.org/${packageName}/latest`;
  const parsed = npmPackageSchema.safeParse(await getJson(endpoint));
  if (!parsed.success) {
    return null;
  }
  const content = [
    `# ${parsed.data.name}`,
    `Version: ${parsed.data.version}`,
    parsed.data.description ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    parsed.data.name,
    content,
    "public-api:npm",
    "public-api:npm:latest"
  );
}

async function fetchPyPi(url: URL): Promise<FetchResult | null> {
  const packageName = url.pathname.match(PYPI_PROJECT_REGEX)?.[1];
  if (!packageName) {
    return null;
  }
  const endpoint = `https://pypi.org/pypi/${packageName}/json`;
  const parsed = pypiPackageSchema.safeParse(await getJson(endpoint));
  if (!parsed.success) {
    return null;
  }
  const { info } = parsed.data;
  const content = [
    `# ${info.name}`,
    `Version: ${info.version}`,
    info.author ? `Author: ${info.author}` : "",
    info.summary ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    info.name,
    content,
    "public-api:pypi",
    "public-api:pypi:json"
  );
}

async function fetchGitHubReleases(url: URL): Promise<FetchResult | null> {
  const match = url.pathname.match(GITHUB_RELEASES_REGEX);
  if (!match) {
    return null;
  }
  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`;
  const parsed = githubReleasesSchema.safeParse(await getJson(endpoint));
  if (!(parsed.success && parsed.data.length > 0)) {
    return null;
  }
  const entries = parsed.data.map((release) => {
    const name = release.name || release.tag_name;
    const prerelease = release.prerelease ? " prerelease" : "";
    const published = release.published_at ? ` · ${release.published_at}` : "";
    const link = release.html_url ? ` · ${release.html_url}` : "";
    return `- ${name}${prerelease}${published}${link}`;
  });
  const title = `${owner}/${repo} releases`;
  return result(
    url.toString(),
    title,
    `## ${title}\n\n${entries.join("\n")}`,
    "public-api:github",
    "public-api:github:releases"
  );
}

async function fetchWayback(url: URL): Promise<FetchResult | null> {
  const target = url.pathname.match(WAYBACK_WEB_REGEX)?.[1];
  if (!target) {
    return null;
  }
  const endpoint = new URL("https://archive.org/wayback/available");
  endpoint.searchParams.set("url", decodeURIComponent(target));
  const parsed = waybackSchema.safeParse(await getJson(endpoint.toString()));
  const closest = parsed.success
    ? parsed.data.archived_snapshots?.closest
    : null;
  if (!(closest?.available && closest.url)) {
    return null;
  }
  const title = `Wayback snapshot ${closest.timestamp ?? ""}`.trim();
  const content = [
    `# ${title}`,
    `Snapshot: ${closest.url}`,
    closest.status ? `Status: ${closest.status}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return result(
    url.toString(),
    title,
    content,
    "public-api:wayback",
    "public-api:wayback:available"
  );
}

function isRegistryProvider(url: URL): boolean {
  return (
    (url.hostname === NPM_HOST && NPM_PACKAGE_REGEX.test(url.pathname)) ||
    (url.hostname === PYPI_HOST && PYPI_PROJECT_REGEX.test(url.pathname)) ||
    (url.hostname === GITHUB_HOST &&
      GITHUB_RELEASES_REGEX.test(url.pathname)) ||
    (url.hostname === WAYBACK_HOST && WAYBACK_WEB_REGEX.test(url.pathname))
  );
}

function fetchRegistryProvider(url: URL): Promise<FetchResult | null> {
  if (url.hostname === NPM_HOST) {
    return fetchNpm(url);
  }
  if (url.hostname === PYPI_HOST) {
    return fetchPyPi(url);
  }
  if (url.hostname === GITHUB_HOST) {
    return fetchGitHubReleases(url);
  }
  if (url.hostname === WAYBACK_HOST) {
    return fetchWayback(url);
  }
  return Promise.resolve(null);
}

export const registryProvidersPublicApiRoute = {
  fetch: fetchRegistryProvider,
  match: isRegistryProvider,
  name: "registry-providers",
} satisfies PublicApiRoute;

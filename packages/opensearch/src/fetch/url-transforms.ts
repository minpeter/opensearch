/**
 * Generic, domain-agnostic URL transforms used to retry a blocked fetch.
 *
 * A blocked desktop URL sometimes succeeds on its mobile host (SSR mobile sites
 * are often less WAF-gated), or on the apex without `www.`. Transforms are pure
 * rules — they never name a specific site. Each returns a new URL or is skipped.
 */

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const WWW_PREFIX = "www.";
const ASSET_EXTENSION_REGEX =
  /\.(?:avif|css|csv|gif|gz|ico|jpe?g|js|json|mjs|mp[34]|pdf|png|svg|txt|webp|xml|zip)$/iu;

export const URL_TRANSFORM_NAMES = [
  "mobile_subdomain",
  "drop_www",
  "am_prefix",
  "json_suffix",
  "rss_path",
  "feed_path",
  "atom_xml_path",
  "rss_xml_path",
  "index_xml_path",
] as const;

export type UrlTransformName = (typeof URL_TRANSFORM_NAMES)[number];

export interface UrlTransformAttempt {
  readonly name: UrlTransformName;
  readonly url: string;
}

// Two-label public suffixes where `b.c` is the registry, so `a.b.c` is an apex
// (e.g. example.co.uk), not a subdomain. Without this, the bare `parts === 2`
// check would skip apex domains under compound TLDs. A short, common-case list —
// not a full public-suffix list — covers the registrars we actually fetch from.
const COMPOUND_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.nz",
  "org.nz",
  "co.za",
  "co.in",
  "com.br",
  "com.cn",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "co.id",
  "co.il",
]);

/** Apex (registrable) host with no subdomain — the only hosts we add `m.` to. */
function isApexHost(host: string): boolean {
  const parts = host.split(".");
  if (parts.length === 2) {
    return true;
  }
  if (parts.length === 3) {
    return COMPOUND_SUFFIXES.has(`${parts[1]}.${parts[2]}`);
  }
  return false;
}

function withHost(url: URL, host: string): string {
  const next = new URL(url.toString());
  next.hostname = host;
  // Never carry Basic-auth credentials across to a different host.
  next.username = "";
  next.password = "";
  return next.toString();
}

function withoutCredentials(url: URL): URL {
  const next = new URL(url.toString());
  next.username = "";
  next.password = "";
  return next;
}

function isTransformablePath(url: URL): boolean {
  const path = url.pathname;
  if (path.endsWith("/")) {
    return true;
  }

  const segment = path.split("/").at(-1) ?? "";
  return !ASSET_EXTENSION_REGEX.test(segment);
}

function pathWithoutTrailingSlash(path: string): string {
  if (path === "/") {
    return "";
  }
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function withPathSuffix(url: URL, suffix: string): string {
  const next = withoutCredentials(url);
  next.hash = "";
  next.search = "";
  next.pathname = `${pathWithoutTrailingSlash(next.pathname)}${suffix}`;
  return next.toString();
}

/**
 * Named variant URLs to try when the original is blocked, in priority order,
 * excluding the original and deduped. Empty for non-http(s), unparseable URLs,
 * deep subdomains, mobile hosts, or obvious asset URLs.
 */
export function transformedUrlAttempts(rawUrl: string): UrlTransformAttempt[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    return [];
  }

  const host = url.hostname.toLowerCase();
  const isWwwHost = host.startsWith(WWW_PREFIX);
  const allowTransforms = isWwwHost || isApexHost(host);
  if (!allowTransforms) {
    return [];
  }

  const out: UrlTransformAttempt[] = [];
  const cleanOriginal = withoutCredentials(url).toString();
  const seen = new Set([url.toString(), cleanOriginal]);
  const add = (name: UrlTransformName, candidate: string): void => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push({ name, url: candidate });
    }
  };
  const addHost = (name: UrlTransformName, candidateHost: string): void => {
    if (candidateHost === "" || candidateHost === host) {
      return;
    }
    const candidate = withHost(url, candidateHost);
    add(name, candidate);
  };

  if (isWwwHost) {
    const apex = host.slice(WWW_PREFIX.length);
    addHost("mobile_subdomain", `m.${apex}`);
    addHost("drop_www", apex);
  } else {
    addHost("am_prefix", `m.${host}`);
  }

  if (isTransformablePath(url)) {
    add("json_suffix", withPathSuffix(url, ".json"));
    add("rss_path", withPathSuffix(url, "/rss"));
    add("feed_path", withPathSuffix(url, "/feed"));
    add("atom_xml_path", withPathSuffix(url, "/atom.xml"));
    add("rss_xml_path", withPathSuffix(url, "/rss.xml"));
    add("index_xml_path", withPathSuffix(url, "/index.xml"));
  }

  return out;
}

export function transformedUrls(rawUrl: string): string[] {
  return transformedUrlAttempts(rawUrl).map((attempt) => attempt.url);
}

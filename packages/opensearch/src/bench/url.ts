/**
 * URL helpers shared by intrinsic (uniqueRatio, urlValidity), consensus, and
 * golden-label matching so that "the same URL" means the same thing everywhere.
 */

const WWW_PREFIX_PATTERN = /^www\./;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const SCHEME_PREFIX_PATTERN = /^[a-z][\w+.-]*:\/\//i;
const TRACKING_PARAM_PATTERN =
  /^(?:utm_|ref$|ref_src$|fbclid$|gclid$|gad_source$|mc_eid$|mc_cid$|igshid$|spm$)/i;
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** True only for http/https URLs. mailto:, javascript:, data: etc. are rejected. */
export function isHttpUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && HTTP_PROTOCOLS.has(url.protocol);
}

function compareKeys(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function stripTrackingParams(url: URL): string {
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_PATTERN.test(key))
    .sort(([a], [b]) => compareKeys(a, b));
  if (kept.length === 0) {
    return "";
  }
  return `?${kept.map(([key, value]) => `${key}=${value}`).join("&")}`;
}

/**
 * Canonical identity for a URL: lowercased host without `www.`, path without a
 * trailing slash, tracking params dropped, protocol and fragment ignored.
 * Returns null for non-http(s) or unparseable URLs.
 */
export function canonicalUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (url === null || !HTTP_PROTOCOLS.has(url.protocol)) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(WWW_PREFIX_PATTERN, "");
  const path = url.pathname.replace(TRAILING_SLASHES_PATTERN, "");
  return `${host}${path}${stripTrackingParams(url)}`;
}

/** Bare registrable-ish host: lowercased, `www.` stripped. Null if unparseable. */
export function hostKey(raw: string): string | null {
  const withScheme = SCHEME_PREFIX_PATTERN.test(raw) ? raw : `https://${raw}`;
  const url = parseUrl(withScheme);
  if (url === null) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(WWW_PREFIX_PATTERN, "");
  return host === "" ? null : host;
}

function labelPath(label: string): string {
  const withScheme = SCHEME_PREFIX_PATTERN.test(label)
    ? label
    : `https://${label}`;
  const url = parseUrl(withScheme);
  if (url === null) {
    return "";
  }
  const path = url.pathname.replace(TRAILING_SLASHES_PATTERN, "");
  return path === "/" ? "" : path;
}

/**
 * Whether a result URL satisfies a golden label. Host match uses a dot boundary
 * so "notexample.com" never matches "example.com" while "docs.example.com" does.
 * When the label carries a path, the result's canonical path must start with it.
 */
export function matchesLabel(resultUrl: string, label: string): boolean {
  const labelHost = hostKey(label);
  const resultHost = hostKey(resultUrl);
  if (labelHost === null || resultHost === null) {
    return false;
  }

  const hostMatch =
    resultHost === labelHost || resultHost.endsWith(`.${labelHost}`);
  if (!hostMatch) {
    return false;
  }

  const requiredPath = labelPath(label);
  if (requiredPath === "") {
    return true;
  }

  const canonical = canonicalUrl(resultUrl);
  if (canonical === null) {
    return false;
  }
  // canonical is "host/path?query"; compare only the path portion, on a segment
  // boundary, so "example.com/docs" matches "/docs" and "/docs/x" but not
  // "/docs-internal" (mirrors the host dot-boundary guard above).
  const slashIndex = canonical.indexOf("/");
  const pathAndQuery = slashIndex === -1 ? "" : canonical.slice(slashIndex);
  const queryIndex = pathAndQuery.indexOf("?");
  const resultPath =
    queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  return (
    resultPath === requiredPath || resultPath.startsWith(`${requiredPath}/`)
  );
}

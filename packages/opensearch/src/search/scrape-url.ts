import type { SearchEngineName } from "./types.ts";

type ScrapeEngineName = Extract<SearchEngineName, "Bing" | "DuckDuckGo">;

const HTTP_PROTOCOL_PREFIXES: readonly ["http://", "https://"] = [
  "http://",
  "https://",
];

const SEARCH_ENGINE_HOSTS: Record<ScrapeEngineName, string[]> = {
  Bing: ["bing.com", "www.bing.com"],
  DuckDuckGo: ["duckduckgo.com", "html.duckduckgo.com", "www.duckduckgo.com"],
};

const SEARCH_ENGINE_INTERNAL_URL_RULES: Record<
  ScrapeEngineName,
  {
    readonly alwaysIgnoreHostPatterns: readonly RegExp[];
    readonly ownedHostPatterns: readonly RegExp[];
  }
> = {
  Bing: {
    alwaysIgnoreHostPatterns: [/\bhelp\.bing\.microsoft\.com$/u],
    ownedHostPatterns: [/\bbing\.com$/u, /\bmicrosoft\.com$/u],
  },
  DuckDuckGo: {
    alwaysIgnoreHostPatterns: [],
    ownedHostPatterns: [/\bduckduckgo\.com$/u],
  },
};

const INTERNAL_PATH_SEGMENT_PATTERNS = [
  /(^|\/)(account|accounts)(\/|$)/u,
  /(^|\/)(captcha|challenge)(\/|$)/u,
  /(^|\/)(feedback|troubleshoot|troubleshooter|troubleshooting)(\/|$)/u,
  /(^|\/)(help|support)(\/|$)/u,
  /(^|\/)(preferences|settings)(\/|$)/u,
  /(^|\/)search(\/|$)/u,
] as const;

const INTERNAL_QUERY_PARAMETER_KEYS = new Set([
  "aqs",
  "ei",
  "form",
  "fpstate",
  "gfe_rd",
  "iflsig",
  "pq",
  "sa",
  "sei",
  "source",
  "ved",
]);

export function hasHttpProtocol(url: string): boolean {
  return HTTP_PROTOCOL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function normalizeBingUrl(url: string): string {
  if (!hasHttpProtocol(url)) {
    return "";
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return "";
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const isBingWrapperHost =
    hostname === "www.bing.com" || hostname === "bing.com";

  if (!(isBingWrapperHost && pathname.startsWith("/ck/a"))) {
    return url.trim();
  }

  const wrappedTarget = parsedUrl.searchParams.get("u")?.trim() ?? "";
  if (!wrappedTarget) {
    return url.trim();
  }

  const decodedTarget = decodeBingWrappedUrl(wrappedTarget);
  return decodedTarget || url.trim();
}

export function normalizeHeuristicUrl(
  engine: ScrapeEngineName,
  url: string
): string {
  const trimmedUrl = url.trim();

  if (
    !trimmedUrl ||
    trimmedUrl.startsWith("#") ||
    trimmedUrl.startsWith("javascript:") ||
    trimmedUrl.startsWith("mailto:") ||
    trimmedUrl.startsWith("tel:")
  ) {
    return "";
  }

  switch (engine) {
    case "Bing": {
      return normalizeBingUrl(trimmedUrl);
    }
    case "DuckDuckGo": {
      return hasHttpProtocol(trimmedUrl) ? trimmedUrl : "";
    }
    default: {
      return "";
    }
  }
}

export function isIgnoredSearchEngineUrl(
  url: string,
  engine: ScrapeEngineName
): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return true;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const searchParams = parsedUrl.searchParams;
  const internalUrlRules = SEARCH_ENGINE_INTERNAL_URL_RULES[engine];

  if (SEARCH_ENGINE_HOSTS[engine].includes(hostname)) {
    return true;
  }

  if (
    internalUrlRules.alwaysIgnoreHostPatterns.some((pattern) =>
      pattern.test(hostname)
    )
  ) {
    return true;
  }

  return isEngineOwnedInternalUrl({
    hostname,
    internalUrlRules,
    pathname,
    searchParams,
  });
}

function isEngineOwnedInternalUrl({
  hostname,
  internalUrlRules,
  pathname,
  searchParams,
}: {
  readonly hostname: string;
  readonly internalUrlRules: {
    readonly ownedHostPatterns: readonly RegExp[];
  };
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
}): boolean {
  const isEngineOwnedInternalHost = internalUrlRules.ownedHostPatterns.some(
    (pattern) => pattern.test(hostname)
  );

  if (!isEngineOwnedInternalHost) {
    return false;
  }

  if (
    INTERNAL_PATH_SEGMENT_PATTERNS.some((pattern) => pattern.test(pathname))
  ) {
    return true;
  }

  return [...searchParams.keys()].some((key) =>
    INTERNAL_QUERY_PARAMETER_KEYS.has(key)
  );
}

function decodeBingWrappedUrl(encodedTarget: string): string {
  if (hasHttpProtocol(encodedTarget)) {
    return encodedTarget;
  }

  const decodedTarget = tryDecodeBingBase64Target(encodedTarget);
  if (!decodedTarget) {
    return "";
  }

  try {
    return new URL(decodedTarget).toString();
  } catch {
    return "";
  }
}

function tryDecodeBingBase64Target(encodedTarget: string): string {
  const normalizedTarget = encodedTarget.startsWith("a1")
    ? encodedTarget.slice(2)
    : encodedTarget;

  if (!normalizedTarget) {
    return "";
  }

  const base64 = normalizedTarget.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  return Buffer.from(paddedBase64, "base64").toString("utf8").trim();
}

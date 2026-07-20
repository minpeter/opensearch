import type { SearchEngineName } from "./types.ts";

type ScrapeEngineName = Extract<SearchEngineName, "DuckDuckGo">;

const HTTP_PROTOCOL_PREFIXES: readonly ["http://", "https://"] = [
  "http://",
  "https://",
];

const SEARCH_ENGINE_HOSTS: Record<ScrapeEngineName, string[]> = {
  DuckDuckGo: ["duckduckgo.com", "html.duckduckgo.com", "www.duckduckgo.com"],
};

const SEARCH_ENGINE_INTERNAL_URL_RULES: Record<
  ScrapeEngineName,
  {
    readonly alwaysIgnoreHostPatterns: readonly RegExp[];
    readonly ownedHostPatterns: readonly RegExp[];
  }
> = {
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
  const { searchParams } = parsedUrl;
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

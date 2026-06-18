import type { FetchAttemptTrace } from "./result.ts";

const API_PATH_MARKERS = ["/api/", "/graphql"] as const;
const COLLECTION_PATH_MARKERS = [
  "/category/",
  "/feed/",
  "/items/",
  "/list",
  "/products",
  "/search",
  "/topics",
] as const;
const JSON_EXTENSION_REGEX = /\.json$/i;
const SECRET_PARAM_REGEX = /token|key|secret|password|auth|session/i;

export type ApiDiscoveryIntent = "auto" | "collection" | "document";

export interface ApiDiscoveryRequest {
  readonly method?: string;
  readonly resourceType?: string;
  readonly status?: number;
  readonly url: string;
}

export interface ApiDiscoveryCandidate {
  readonly method: string;
  readonly reasons: readonly string[];
  readonly resourceType?: string;
  readonly status?: number;
  readonly url: string;
}

export interface ApiDiscoveryReport {
  readonly candidates: readonly ApiDiscoveryCandidate[];
  readonly hint?: string;
  readonly targetUrl: string;
  readonly traceSummary: readonly string[];
}

export function apiDiscoveryHint(
  targetUrl: string,
  trace: readonly FetchAttemptTrace[],
  intent: ApiDiscoveryIntent = "auto"
): string | undefined {
  if (!isApiDiscoveryEligible(targetUrl, trace, intent)) {
    return;
  }
  return "api_discovery_hint: repeated WAF challenge; inspect browser network requests for JSON or GraphQL endpoints.";
}

export function buildApiDiscoveryReport(input: {
  readonly requests: readonly ApiDiscoveryRequest[];
  readonly targetUrl: string;
  readonly trace?: readonly FetchAttemptTrace[];
}): ApiDiscoveryReport {
  const candidates = uniqueCandidates(
    input.requests.flatMap((request) => candidateFromRequest(request))
  );
  return {
    candidates,
    hint:
      candidates.length > 0
        ? `api_discovery_candidates:${candidates.length}`
        : undefined,
    targetUrl: input.targetUrl,
    traceSummary: (input.trace ?? []).map(traceLine),
  };
}

export function isApiDiscoveryEligible(
  targetUrl: string,
  trace: readonly FetchAttemptTrace[],
  intent: ApiDiscoveryIntent = "auto"
): boolean {
  if (!collectionIntent(targetUrl, intent)) {
    return false;
  }
  const challenged = trace.filter((attempt) =>
    ["blocked", "challenge"].includes(attempt.verdict ?? "")
  );
  const hasKnownProfile = challenged.some(
    (attempt) =>
      attempt.profileUsed && attempt.profileUsed !== "unknown_challenge"
  );
  return challenged.length >= 2 && hasKnownProfile;
}

function candidateFromRequest(
  request: ApiDiscoveryRequest
): readonly ApiDiscoveryCandidate[] {
  const reasons = candidateReasons(request);
  if (reasons.length === 0) {
    return [];
  }
  return [
    {
      method: request.method ?? "GET",
      reasons,
      resourceType: request.resourceType,
      status: request.status,
      url: redactUrl(request.url),
    },
  ];
}

function candidateReasons(request: ApiDiscoveryRequest): readonly string[] {
  const url = parseUrl(request.url);
  if (!url) {
    return [];
  }
  const path = url.pathname.toLowerCase();
  const reasons: string[] = [];
  if (API_PATH_MARKERS.some((marker) => path.includes(marker))) {
    reasons.push("api_path");
  }
  if (JSON_EXTENSION_REGEX.test(path)) {
    reasons.push("json_path");
  }
  if (request.resourceType && ["fetch", "xhr"].includes(request.resourceType)) {
    reasons.push(`resource:${request.resourceType}`);
  }
  return reasons;
}

function collectionIntent(
  targetUrl: string,
  intent: ApiDiscoveryIntent
): boolean {
  if (intent === "collection") {
    return true;
  }
  if (intent === "document") {
    return false;
  }
  const url = parseUrl(targetUrl);
  if (!url) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  return (
    path === "/" ||
    COLLECTION_PATH_MARKERS.some((marker) => path.includes(marker)) ||
    url.searchParams.has("q") ||
    url.searchParams.has("query") ||
    url.searchParams.has("search")
  );
}

function uniqueCandidates(
  candidates: readonly ApiDiscoveryCandidate[]
): readonly ApiDiscoveryCandidate[] {
  const seen = new Set<string>();
  const unique: ApiDiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.method} ${candidate.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

function redactUrl(value: string): string {
  const url = parseUrl(value);
  if (!url) {
    return value;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_PARAM_REGEX.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  url.hash = "";
  return url.toString();
}

function traceLine(attempt: FetchAttemptTrace): string {
  return [
    attempt.name,
    attempt.verdict ?? "unknown",
    attempt.profileUsed,
    attempt.summary,
  ]
    .filter(Boolean)
    .join(" | ");
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

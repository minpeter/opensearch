import { selectorMatches } from "./challenge-selectors.ts";
import type { FetchVerdict } from "./result.ts";
import {
  loadWafProfiles,
  rankWafProfiles,
  type WafProfile,
  type WafProfileMatch,
} from "./waf-profiles.ts";

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const CHALLENGE_BODY_THRESHOLD = 3000;
const DEFAULT_SIZE_TOLERANCE = 20;
const BLOCKED_STATUSES = new Set([403, 429, 430, 503]);

const STRONG_MARKERS = [
  "cf-chl-bypass",
  "/cdn-cgi/challenge-platform",
  "window._cf_chl_opt",
  "sec-if-cpt-container",
  "powered and protected by akamai",
  "request unsuccessful. incapsula incident",
] as const;

const WEAK_MARKERS = [
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "the requested url was rejected",
  "verify you are human",
  "access denied",
  "datadome",
] as const;

const WEAK_TITLE_MARKERS = new Set<string>([
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "verify you are human",
]);

export interface ChallengeValidationInput {
  readonly body?: string;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>> | Headers;
  readonly knownBadSizes?: readonly number[];
  readonly profileSource?: unknown;
  readonly profiles?: readonly WafProfile[];
  readonly sizeTolerance?: number;
  readonly status?: number;
  readonly successSelectors?: readonly string[];
  readonly tinyBodyIsChallenge?: boolean;
  readonly title?: string;
}

export interface ChallengeValidationResult {
  readonly bodySize: number;
  readonly matchedSelectors: readonly string[];
  readonly profileLoadError?: string;
  readonly profiles: readonly WafProfileMatch[];
  readonly reasons: readonly string[];
  readonly status: number;
  readonly verdict: FetchVerdict;
}

type ChallengeValidationBase = Omit<
  ChallengeValidationResult,
  "reasons" | "verdict"
>;

function titleText(lowerHtml: string): string {
  return lowerHtml.match(TITLE_REGEX)?.[1] ?? "";
}

export function isChallengePage(html: string): boolean {
  const { verdict } = validateChallenge({
    body: html,
    tinyBodyIsChallenge: false,
  });
  return verdict === "challenge" || verdict === "blocked";
}

export function validateChallenge(
  input: ChallengeValidationInput
): ChallengeValidationResult {
  const body = input.body ?? "";
  const lowerBody = body.toLowerCase();
  const status = input.status ?? 200;
  const headers = normalizeHeaders(input.headers);
  const cookies = input.cookies ?? {};
  const loadedProfiles =
    input.profiles === undefined
      ? loadWafProfiles(input.profileSource)
      : { profiles: input.profiles };
  const profiles = rankWafProfiles({
    body,
    cookies,
    headers,
    profiles: loadedProfiles.profiles,
  });
  const base = {
    bodySize: body.length,
    matchedSelectors: [] as readonly string[],
    profileLoadError: loadedProfiles.error,
    profiles,
    status,
  };
  const blockedReason = blockedStatusReason(status);

  if (blockedReason) {
    return withReasons(base, "blocked", [blockedReason]);
  }

  const markerReasons = challengeMarkerReasons(lowerBody, input.title);
  if (markerReasons.length > 0) {
    return withReasons(base, "challenge", markerReasons);
  }

  const sizeReason = knownBadSizeReason(
    body.length,
    input.knownBadSizes ?? [],
    input.sizeTolerance ?? DEFAULT_SIZE_TOLERANCE
  );
  if (sizeReason) {
    return withReasons(base, "challenge", [sizeReason]);
  }

  const selectors = input.successSelectors ?? [];
  const selectorResult = selectorVerdict(base, body, selectors, cookies);
  if (selectorResult) {
    return selectorResult;
  }

  if (
    input.tinyBodyIsChallenge !== false &&
    body.length > 0 &&
    body.length < CHALLENGE_BODY_THRESHOLD
  ) {
    return withReasons(base, "challenge", [`tiny_body:${body.length}`]);
  }

  const cookieReason = unresolvedCookieReason(cookies);
  return withReasons(base, "weak_ok", cookieReason ? [cookieReason] : []);
}

function blockedStatusReason(status: number): string | null {
  if (status === 0 || BLOCKED_STATUSES.has(status) || status >= 400) {
    return `status:${status}`;
  }
  return null;
}

function selectorVerdict(
  base: ChallengeValidationBase,
  body: string,
  selectors: readonly string[],
  cookies: Readonly<Record<string, string>>
): ChallengeValidationResult | null {
  if (selectors.length === 0) {
    return null;
  }
  const matchedSelectors = selectors.filter((selector) =>
    selectorMatches(body, selector)
  );
  if (matchedSelectors.length === 0) {
    return withReasons(base, "challenge", ["no_success_selector"]);
  }
  const cookieReason = unresolvedCookieReason(cookies);
  return {
    ...base,
    matchedSelectors,
    reasons: cookieReason ? [cookieReason] : [],
    verdict: cookieReason ? "weak_ok" : "strong_ok",
  };
}

function challengeMarkerReasons(
  lowerBody: string,
  explicitTitle: string | undefined
): string[] {
  const reasons = STRONG_MARKERS.filter((marker) =>
    lowerBody.includes(marker)
  ).map((marker) => `marker:${marker}`);
  const title = (explicitTitle ?? titleText(lowerBody)).toLowerCase();
  const weakHits = WEAK_MARKERS.filter((marker) => lowerBody.includes(marker));
  for (const marker of weakHits) {
    const titleHit = WEAK_TITLE_MARKERS.has(marker) && title.includes(marker);
    if (titleHit || lowerBody.length < CHALLENGE_BODY_THRESHOLD) {
      reasons.push(`marker:${marker}`);
    }
  }
  return reasons;
}

function knownBadSizeReason(
  size: number,
  knownBadSizes: readonly number[],
  tolerance: number
): string | null {
  const badSize = knownBadSizes.find(
    (candidate) => Math.abs(size - candidate) <= tolerance
  );
  return badSize === undefined ? null : `size_fp:${size}~${badSize}`;
}

function unresolvedCookieReason(
  cookies: Readonly<Record<string, string>>
): string | null {
  return cookies._abck?.includes("~-1~") ? "abck_unresolved" : null;
}

function normalizeHeaders(
  headers: ChallengeValidationInput["headers"]
): Readonly<Record<string, string>> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value])
    );
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function withReasons(
  base: ChallengeValidationBase,
  verdict: FetchVerdict,
  reasons: readonly string[]
): ChallengeValidationResult {
  return { ...base, reasons, verdict };
}

import { DEFAULT_WAF_PROFILES } from "./waf-profile-defaults.ts";

type DetectorMap = Readonly<Record<string, readonly string[] | undefined>>;

export interface WafProfile {
  readonly confidenceRules?: {
    readonly strong?: number;
    readonly weak?: number;
  };
  readonly detectors: DetectorMap;
  readonly fallbackWhenChallenge?: readonly string[];
  readonly id: string;
}

export interface WafProfileLoadResult {
  readonly error?: string;
  readonly profiles: readonly WafProfile[];
}

export interface WafProfileMatch {
  readonly confidence: number;
  readonly profileId: string;
  readonly signals: readonly string[];
}

const UNKNOWN_PROFILE = DEFAULT_WAF_PROFILES.at(-1) as WafProfile;

export function loadWafProfiles(candidate?: unknown): WafProfileLoadResult {
  if (candidate === undefined) {
    return { profiles: DEFAULT_WAF_PROFILES };
  }
  if (!isRecord(candidate)) {
    return {
      error: "profile_loader:invalid_shape",
      profiles: DEFAULT_WAF_PROFILES,
    };
  }

  const profiles = Object.entries(candidate)
    .filter(([id]) => !id.startsWith("_"))
    .map(([id, value]) => normalizeProfile(id, value))
    .filter((profile): profile is WafProfile => Boolean(profile));

  if (profiles.length === 0) {
    return {
      error: "profile_loader:no_usable_profiles",
      profiles: DEFAULT_WAF_PROFILES,
    };
  }
  return { profiles: ensureUnknownProfile(profiles) };
}

export function rankWafProfiles(input: {
  readonly body?: string;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly profiles?: readonly WafProfile[];
}): readonly WafProfileMatch[] {
  const profiles = input.profiles ?? DEFAULT_WAF_PROFILES;
  const matches = profiles
    .map((profile) => scoreProfile(profile, input))
    .filter((match): match is WafProfileMatch => Boolean(match))
    .sort((left, right) => right.confidence - left.confidence);

  if (matches.length > 0) {
    return matches;
  }
  return [
    {
      confidence: 0.1,
      profileId: UNKNOWN_PROFILE.id,
      signals: ["fallback"],
    },
  ];
}

function ensureUnknownProfile(
  profiles: readonly WafProfile[]
): readonly WafProfile[] {
  if (profiles.some((profile) => profile.id === UNKNOWN_PROFILE.id)) {
    return profiles;
  }
  return [...profiles, UNKNOWN_PROFILE];
}

function normalizeProfile(id: string, value: unknown): WafProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const detectors = normalizeDetectors(value.detectors);
  if (!detectors && id !== UNKNOWN_PROFILE.id) {
    return null;
  }
  return {
    confidenceRules: normalizeConfidenceRules(value.confidenceRules),
    detectors: detectors ?? {},
    fallbackWhenChallenge: stringArray(value.fallbackWhenChallenge),
    id,
  };
}

function normalizeConfidenceRules(
  value: unknown
): WafProfile["confidenceRules"] {
  if (!isRecord(value)) {
    return;
  }
  return {
    strong: numericRule(value.strong),
    weak: numericRule(value.weak),
  };
}

function normalizeDetectors(value: unknown): DetectorMap | null {
  if (!isRecord(value)) {
    return null;
  }
  const detectors: Record<string, readonly string[]> = {};
  for (const key of ["body", "cookie", "header", "server_contains"] as const) {
    const values = stringArray(value[key]);
    if (values.length > 0) {
      detectors[key] = values;
    }
  }
  return detectors;
}

function scoreProfile(
  profile: WafProfile,
  input: {
    readonly body?: string;
    readonly cookies?: Readonly<Record<string, string>>;
    readonly headers?: Readonly<Record<string, string>>;
  }
): WafProfileMatch | null {
  if (profile.id === UNKNOWN_PROFILE.id) {
    return null;
  }
  const signals = [
    ...patternHits(Object.keys(input.cookies ?? {}), profile.detectors.cookie),
    ...patternHits(Object.keys(input.headers ?? {}), profile.detectors.header),
    ...serverHits(input.headers, profile.detectors.server_contains),
    ...bodyHits(input.body, profile.detectors.body),
  ];
  if (signals.length === 0) {
    return null;
  }
  const strong = profile.confidenceRules?.strong ?? 2;
  const weak = profile.confidenceRules?.weak ?? 1;
  const confidence = profileConfidence(signals.length, strong, weak);
  return { confidence, profileId: profile.id, signals };
}

function profileConfidence(
  signalCount: number,
  strong: number,
  weak: number
): number {
  if (signalCount >= strong) {
    return 0.9;
  }
  if (signalCount >= weak) {
    return 0.6;
  }
  return 0.3;
}

function patternHits(
  keys: readonly string[],
  patterns: readonly string[] = []
): string[] {
  const loweredKeys = keys.map((key) => key.toLowerCase());
  return patterns
    .filter((pattern) =>
      loweredKeys.some((key) => wildcardMatch(key, pattern.toLowerCase()))
    )
    .map((pattern) => `signal:${pattern}`);
}

function serverHits(
  headers: Readonly<Record<string, string>> | undefined,
  needles: readonly string[] = []
): string[] {
  const server = headerValue(headers, "server").toLowerCase();
  return needles
    .filter((needle) => server.includes(needle.toLowerCase()))
    .map((needle) => `server:${needle}`);
}

function bodyHits(body = "", needles: readonly string[] = []): string[] {
  const lowerBody = body.toLowerCase();
  return needles
    .filter((needle) => lowerBody.includes(needle.toLowerCase()))
    .map((needle) => `body:${needle}`);
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string {
  const lowerName = name.toLowerCase();
  return (
    Object.entries(headers ?? {}).find(
      ([key]) => key.toLowerCase() === lowerName
    )?.[1] ?? ""
  );
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numericRule(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

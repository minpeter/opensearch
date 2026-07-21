import type { OpenSearchFailureKind } from "./observability-events.ts";

export function getFailureKind(error: unknown): OpenSearchFailureKind {
  return failureDetails(error).kind;
}

export function failureDetails(error: unknown): {
  readonly kind: OpenSearchFailureKind;
  readonly status?: number;
} {
  if (!(error instanceof Error)) {
    return { kind: "unknown" };
  }

  const candidate = error as Error & {
    readonly kind?: unknown;
    readonly status?: unknown;
  };
  const kind = isFailureKind(candidate.kind) ? candidate.kind : "unknown";
  return typeof candidate.status === "number"
    ? { kind, status: candidate.status }
    : { kind };
}

function isFailureKind(value: unknown): value is OpenSearchFailureKind {
  return (
    value === "blocked" ||
    value === "misconfigured" ||
    value === "no-results" ||
    value === "transient" ||
    value === "unknown"
  );
}

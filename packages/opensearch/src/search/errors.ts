import { getErrorMessage as getSharedErrorMessage } from "../providers/shared/error.ts";
import type { EngineFailureKind, SearchEngineName } from "./types.ts";

export class SearchExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SearchExecutionError";
    this.retryable = retryable;
  }
}

export class SearchEngineError extends Error {
  readonly engine: SearchEngineName;
  readonly kind: EngineFailureKind;
  readonly status?: number;

  constructor(
    engine: SearchEngineName,
    kind: EngineFailureKind,
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {}
  ) {
    super(message, { cause: options.cause });
    this.engine = engine;
    this.kind = kind;
    this.name = "SearchEngineError";
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export function getErrorMessage(error: unknown): string {
  return getSharedErrorMessage(error);
}

export function formatFailureSummary(failures: SearchEngineError[]): string {
  if (failures.length === 0) {
    return "";
  }

  const details = failures
    .map((failure) => `${failure.engine}:${failure.kind}`)
    .join("; ");

  return ` [${details}]`;
}

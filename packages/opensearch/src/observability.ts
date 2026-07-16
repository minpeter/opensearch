export type OpenSearchOperation = "fetch" | "search";
let observerSequence = 0;
export type OpenSearchFailureKind =
  | "blocked"
  | "misconfigured"
  | "no-results"
  | "transient"
  | "unknown";

export interface OpenSearchErrorDetails {
  readonly name: string;
}

interface OpenSearchEventBase {
  readonly operation: OpenSearchOperation;
  readonly operationId: string;
  readonly timestampMs: number;
}

export interface OpenSearchOperationEvent extends OpenSearchEventBase {
  readonly durationMs?: number;
  readonly error?: OpenSearchErrorDetails;
  readonly inputCount: number;
  readonly phase: "failure" | "start" | "success";
  readonly resultCount?: number;
  readonly type: "operation";
}

export interface OpenSearchCacheEvent extends OpenSearchEventBase {
  readonly status: "bypass" | "hit" | "miss";
  readonly type: "cache";
}

export interface OpenSearchProviderEvent extends OpenSearchEventBase {
  readonly durationMs?: number;
  readonly error?: OpenSearchErrorDetails;
  readonly failureKind?: OpenSearchFailureKind;
  readonly phase: "empty" | "failure" | "start" | "success";
  readonly provider: string;
  readonly resultCount?: number;
  readonly status?: number;
  readonly type: "provider";
}

export interface OpenSearchFallbackEvent extends OpenSearchEventBase {
  readonly fromProvider: string;
  readonly reason?: OpenSearchFailureKind | "empty";
  readonly toProvider: string;
  readonly type: "fallback";
}

export type OpenSearchEvent =
  | OpenSearchCacheEvent
  | OpenSearchFallbackEvent
  | OpenSearchOperationEvent
  | OpenSearchProviderEvent;

export type OpenSearchEventSink = (
  event: OpenSearchEvent
) => PromiseLike<void> | void;

export interface OpenSearchObservabilityOptions {
  /**
   * Receives structured lifecycle events. Inputs are intentionally omitted so
   * metrics and traces do not leak queries or URLs by default.
   */
  readonly onEvent?: OpenSearchEventSink;
}

export interface OpenSearchObserver {
  createOperationId(operation: OpenSearchOperation): string;
  emit(event: OpenSearchEvent): void;
  now(): number;
}

interface ProviderAttemptContext {
  readonly operation: OpenSearchOperation;
  readonly operationId: string;
  readonly provider: string;
}

interface OperationContext {
  readonly inputCount: number;
  readonly operation: OpenSearchOperation;
}

export function createOpenSearchObserver(
  sink?: OpenSearchEventSink
): OpenSearchObserver {
  const observerId = createObserverId();
  let sequence = 0;
  const now = () => Date.now();

  return {
    createOperationId(operation) {
      sequence += 1;
      return `${operation}-${observerId}-${sequence.toString(36)}`;
    },
    emit(event) {
      if (!sink) {
        return;
      }
      try {
        const pending = sink(event);
        if (pending) {
          Promise.resolve(pending).catch(() => undefined);
        }
      } catch {
        // Observability must never alter search or fetch behavior.
      }
    },
    now,
  };
}

function createObserverId(): string {
  observerSequence += 1;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${observerSequence.toString(36)}`
  );
}

export async function observeOperation<T>(
  observer: OpenSearchObserver,
  context: OperationContext,
  execute: (operationId: string) => Promise<T>,
  countResults: (result: T) => number = defaultResultCount
): Promise<T> {
  const operationId = observer.createOperationId(context.operation);
  const startedAt = observer.now();
  observer.emit({
    inputCount: context.inputCount,
    operation: context.operation,
    operationId,
    phase: "start",
    timestampMs: startedAt,
    type: "operation",
  });

  try {
    const result = await execute(operationId);
    const completedAt = observer.now();
    observer.emit({
      durationMs: completedAt - startedAt,
      inputCount: context.inputCount,
      operation: context.operation,
      operationId,
      phase: "success",
      resultCount: countResults(result),
      timestampMs: completedAt,
      type: "operation",
    });
    return result;
  } catch (error) {
    const completedAt = observer.now();
    observer.emit({
      durationMs: completedAt - startedAt,
      error: errorDetails(error),
      inputCount: context.inputCount,
      operation: context.operation,
      operationId,
      phase: "failure",
      timestampMs: completedAt,
      type: "operation",
    });
    throw error;
  }
}

export async function observeProviderAttempt<T>(
  observer: OpenSearchObserver,
  context: ProviderAttemptContext,
  execute: () => Promise<T>,
  countResults: (result: T) => number = defaultResultCount
): Promise<T> {
  const startedAt = observer.now();
  observer.emit({
    operation: context.operation,
    operationId: context.operationId,
    phase: "start",
    provider: context.provider,
    timestampMs: startedAt,
    type: "provider",
  });

  try {
    const result = await execute();
    const completedAt = observer.now();
    const resultCount = countResults(result);
    observer.emit({
      durationMs: completedAt - startedAt,
      operation: context.operation,
      operationId: context.operationId,
      phase: resultCount === 0 ? "empty" : "success",
      provider: context.provider,
      resultCount,
      timestampMs: completedAt,
      type: "provider",
    });
    return result;
  } catch (error) {
    const completedAt = observer.now();
    const failure = failureDetails(error);
    observer.emit({
      durationMs: completedAt - startedAt,
      error: errorDetails(error),
      failureKind: failure.kind,
      operation: context.operation,
      operationId: context.operationId,
      phase: "failure",
      provider: context.provider,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      timestampMs: completedAt,
      type: "provider",
    });
    throw error;
  }
}

export function emitCacheEvent(
  observer: OpenSearchObserver,
  operation: OpenSearchOperation,
  operationId: string,
  status: OpenSearchCacheEvent["status"]
): void {
  observer.emit({
    operation,
    operationId,
    status,
    timestampMs: observer.now(),
    type: "cache",
  });
}

export function emitFallbackEvent(
  observer: OpenSearchObserver,
  context: {
    readonly fromProvider: string;
    readonly operation: OpenSearchOperation;
    readonly operationId: string;
    readonly reason?: OpenSearchFallbackEvent["reason"];
    readonly toProvider: string;
  }
): void {
  observer.emit({
    fromProvider: context.fromProvider,
    operation: context.operation,
    operationId: context.operationId,
    ...(context.reason === undefined ? {} : { reason: context.reason }),
    timestampMs: observer.now(),
    toProvider: context.toProvider,
    type: "fallback",
  });
}

export function getFailureKind(error: unknown): OpenSearchFailureKind {
  return failureDetails(error).kind;
}

function defaultResultCount(result: unknown): number {
  if (result === null || result === undefined) {
    return 0;
  }
  return Array.isArray(result) ? result.length : 1;
}

function errorDetails(error: unknown): OpenSearchErrorDetails {
  if (error instanceof Error) {
    return { name: error.name };
  }
  return { name: "UnknownError" };
}

function failureDetails(error: unknown): {
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

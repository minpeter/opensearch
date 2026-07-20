import type {
  OpenSearchCacheEvent,
  OpenSearchErrorDetails,
  OpenSearchEventSink,
  OpenSearchFallbackEvent,
  OpenSearchObserver,
  OpenSearchOperation,
} from "./observability-events.ts";
import { failureDetails } from "./observability-failure.ts";

export type {
  OpenSearchCacheEvent,
  OpenSearchErrorDetails,
  OpenSearchEvent,
  OpenSearchEventSink,
  OpenSearchFailureKind,
  OpenSearchFallbackEvent,
  OpenSearchObservabilityOptions,
  OpenSearchObserver,
  OpenSearchOperation,
  OpenSearchOperationEvent,
  OpenSearchProviderEvent,
} from "./observability-events.ts";
// biome-ignore lint/performance/noBarrelFile: observability.ts remains the single public entry after the internal split; consumers must not depend on sub-module layout.
export { getFailureKind } from "./observability-failure.ts";

let observerSequence = 0;

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
        Promise.resolve(sink(event)).catch(() => undefined);
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

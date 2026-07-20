export type OpenSearchOperation = "fetch" | "search";

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
  createOperationId: (operation: OpenSearchOperation) => string;
  emit: (event: OpenSearchEvent) => void;
  now: () => number;
}

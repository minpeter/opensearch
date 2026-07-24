import {
  emitFallbackEvent,
  type OpenSearchObserver,
} from "../observability.ts";
import { getErrorMessage } from "../providers/shared/error.ts";
import {
  formatFailureSummary,
  SearchEngineError,
  SearchExecutionError,
  TerminalSearchError,
} from "./errors.ts";
import type { SearchProvider } from "./types.ts";

export function handleSequentialProviderError(
  provider: SearchProvider,
  nextProvider: SearchProvider | undefined,
  error: unknown,
  failures: SearchEngineError[],
  observer: OpenSearchObserver,
  operationId: string
): void {
  if (!(error instanceof SearchEngineError)) {
    throw error;
  }
  if (error.status === 451) {
    throw error;
  }
  failures.push(error);
  if (nextProvider) {
    emitFallbackEvent(observer, {
      fromProvider: provider.name,
      operation: "search",
      operationId,
      reason: error.kind,
      toProvider: nextProvider.name,
    });
  }
}

export function handleStreamProviderError(
  provider: SearchProvider,
  error: unknown,
  failures: SearchEngineError[]
): void {
  if (error instanceof TerminalSearchError) {
    throw error.originalError;
  }
  if (error instanceof SearchEngineError) {
    if (error.status === 451) {
      throw error;
    }
    failures.push(error);
    return;
  }
  failures.push(
    new SearchEngineError(
      provider.name,
      "transient",
      `${provider.name} search failed: ${getErrorMessage(error)}`
    )
  );
}

export function shouldRetrySearchError(error: Error): boolean {
  if (error instanceof TerminalSearchError) {
    return false;
  }
  if (error instanceof SearchEngineError && error.status === 451) {
    return false;
  }
  if (error instanceof SearchExecutionError) {
    return error.retryable;
  }

  return true;
}

export function rethrowTerminalSearchError(error: unknown): never {
  if (error instanceof TerminalSearchError) {
    throw error.originalError;
  }
  throw error;
}

export function createSearchExecutionError(
  failures: SearchEngineError[]
): SearchExecutionError {
  if (failures.every((failure) => failure.kind === "no-results")) {
    return new SearchExecutionError("No Results", false);
  }

  const failedEngines = failures.map((failure) => failure.engine).join(", ");
  const failureSummary = formatFailureSummary(failures);

  if (failures.every((failure) => failure.kind === "blocked")) {
    return new SearchExecutionError(
      `All search engines failed: ${failedEngines}${failureSummary}`,
      false
    );
  }

  if (failures.every((failure) => failure.kind !== "no-results")) {
    return new SearchExecutionError(
      `Search failed across all engines: ${failedEngines}${failureSummary}`,
      failures.every((failure) => failure.kind === "transient")
    );
  }

  return new SearchExecutionError(
    `All search engines failed: ${failedEngines}${failureSummary}`,
    false
  );
}

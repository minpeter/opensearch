import { getErrorMessage, SearchEngineError } from "../../errors.ts";
import type { SearchResult } from "../../types.ts";

export type ProviderOutcome = PromiseSettledResult<SearchResult[]>;

export function createAugmentedBingFailure(
  outcomes: readonly ProviderOutcome[]
): SearchEngineError {
  const failures = outcomes.map(getOutcomeFailure);
  const kind = failures.every((failure) => failure.kind === "no-results")
    ? "no-results"
    : "transient";
  const summary = failures
    .map((failure) => `${failure.engine}:${failure.kind}`)
    .join("; ");

  return new SearchEngineError(
    "Bing",
    kind,
    `Augmented Bing fallback failed: ${summary}`
  );
}

function getOutcomeFailure(outcome: ProviderOutcome): SearchEngineError {
  if (outcome.status === "fulfilled") {
    return new SearchEngineError("Bing", "no-results", "No Results");
  }

  if (outcome.reason instanceof SearchEngineError) {
    return outcome.reason;
  }

  return new SearchEngineError(
    "Bing",
    "transient",
    `Bing supplement failed: ${getErrorMessage(outcome.reason)}`
  );
}

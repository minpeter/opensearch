import {
  cleanProviderText,
  dedupeProviderResults,
  normalizeProviderResult,
  truncateProviderText,
} from "../providers/shared/result.ts";
import type { ParsedResult, SearchEngineName, SearchResult } from "./types.ts";

export function cleanText(text: string): string {
  return cleanProviderText(text);
}

export function truncateText(text: string, maxLength: number): string {
  return truncateProviderText(text, maxLength);
}

export function normalizeResult(result: ParsedResult): ParsedResult | null {
  return normalizeProviderResult(result);
}

export function attachEngine(
  engine: SearchEngineName,
  results: readonly ParsedResult[]
): SearchResult[] {
  return results.map((result) => ({ ...result, engine }));
}

export function dedupeResults(
  results: readonly ParsedResult[]
): ParsedResult[] {
  return dedupeProviderResults(results);
}

export const DEFAULT_MAX_CHARACTERS = 12_000;
/** Conservative per-call fan-out bound; clients can override it. */
export const DEFAULT_MAX_CONCURRENCY = 8;
export const EXA_API_KEY_ENV = "EXA_API_KEY";
export const OPENSEARCH_ENABLE_EXA_MCP_ENV = "OPENSEARCH_ENABLE_EXA_MCP";

export function requireMaxCharacters(maxCharacters: number): number {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) {
    throw new RangeError("maxCharacters must be a positive safe integer");
  }

  return maxCharacters;
}

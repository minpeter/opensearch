import type { vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { createOllamaSearchProvider } from "../search/providers/ollama.ts";

interface OllamaSearchResult {
  content?: string;
  title?: string;
  url?: string;
}

export function connectionRefusedError(): TypeError {
  return new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
}

export function enableOllamaEnv(overrides: Record<string, string> = {}) {
  return createEnvironmentReader({
    OPENSEARCH_ENABLE_OLLAMA: "true",
    ...overrides,
  });
}

export function getOllamaSearchProvider(
  env: ReturnType<typeof createEnvironmentReader>
) {
  const provider = createOllamaSearchProvider(env);
  if (!provider) {
    throw new Error("Ollama search provider was not enabled for this test");
  }
  return provider;
}

export const ollamaSearchBody = (results: OllamaSearchResult[] = []) => ({
  results,
});

export function requestOf(
  mockFetch: ReturnType<typeof vi.fn>,
  index = 0
): { body: unknown; init: RequestInit; url: string } {
  const [url, init] = mockFetch.mock.calls[index] ?? [];
  const body = init?.body;
  return {
    body: typeof body === "string" ? JSON.parse(body) : undefined,
    init: init ?? {},
    url: String(url),
  };
}

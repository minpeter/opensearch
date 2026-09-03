import { afterEach, describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { createOllamaSearchProvider } from "../search/providers/ollama.ts";

function enabledOllamaProvider() {
  const provider = createOllamaSearchProvider(
    createEnvironmentReader({
      OLLAMA_API_KEY: "cloud-key",
      OPENSEARCH_ENABLE_OLLAMA: "true",
    })
  );
  if (!provider) {
    throw new Error("Ollama provider was not enabled");
  }
  return provider;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search provider cancellation", () => {
  it("does not fall back to cloud after Ollama caller cancellation", async () => {
    const reason = new Error("caller stopped");
    const controller = new AbortController();
    controller.abort(reason);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      enabledOllamaProvider().search("query", 5, controller.signal)
    ).rejects.toBe(reason);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

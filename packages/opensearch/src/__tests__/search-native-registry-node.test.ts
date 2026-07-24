import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenSearch } from "../node.ts";
import { SearchEngineError } from "../search/errors.ts";
import type { NativeSearchRegistry } from "../search/native-registry.ts";
import { createMockResponse } from "./search-test-helpers.ts";

describe("native search registry in the node runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retains node providers after a retryable native failure", async () => {
    const nativeSearch = vi
      .fn()
      .mockRejectedValue(
        new SearchEngineError("Kimi", "transient", "native session unavailable")
      );
    const registry: NativeSearchRegistry = {
      resolve: () => ({
        active: {
          engine: "Kimi",
          id: "session:kimi",
          search: nativeSearch,
        },
        available: [],
      }),
    };
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse(`
        <div class="result results_links">
          <a class="result__a" href="https://node.example/result">Node result</a>
          <div class="result__snippet">Node fallback.</div>
        </div>
      `)
    );
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearch({
      env: {
        OPENSEARCH_ENABLE_EXA_MCP: "false",
        OPENSEARCH_ENABLE_FIRECRAWL: "false",
        OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
      },
      search: {
        cache: { enabled: false },
        nativeRegistry: registry,
      },
    });

    await expect(client.search("node provider fallback", 1)).resolves.toEqual([
      {
        engine: "DuckDuckGo",
        snippet: "Node fallback.",
        title: "Node result",
        url: "https://node.example/result",
      },
    ]);
    expect(nativeSearch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

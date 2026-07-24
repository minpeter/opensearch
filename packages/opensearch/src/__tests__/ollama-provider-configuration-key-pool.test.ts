import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenSearchWithRuntime } from "../client.ts";
import {
  createEnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { tryFetchUrlViaOllama } from "../fetch/ollama-provider.ts";
import { resolveLocalBaseUrl } from "../providers/ollama/config.ts";
import { getNodeSearchProviders } from "../search/node-providers.ts";
import { createOllamaSearchProvider } from "../search/providers/ollama.ts";
import { createSearchService } from "../search.ts";
import {
  enableOllamaEnv,
  getOllamaSearchProvider,
  ollamaSearchBody,
  requestOf,
} from "./ollama-provider-test-helpers.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

const nodeSearch = createSearchService(processEnvironmentReader, {
  providers: getNodeSearchProviders,
}).search;

beforeEach(() => {
  resetSearchEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSearchEnv();
});

describe("Ollama configuration and key pool", () => {
  it("resolves OLLAMA_HOST without a scheme to an http origin", () => {
    const env = createEnvironmentReader({ OLLAMA_HOST: "127.0.0.1:11434" });
    expect(resolveLocalBaseUrl(env)).toBe("http://127.0.0.1:11434");
  });

  it("preserves an explicit https OLLAMA_HOST and strips the path", () => {
    const env = createEnvironmentReader({
      OLLAMA_HOST: "https://ollama.example.internal:8443/foo",
    });
    expect(resolveLocalBaseUrl(env)).toBe(
      "https://ollama.example.internal:8443"
    );
  });

  it("falls back to the default local URL for malformed hosts", () => {
    const env = createEnvironmentReader({ OLLAMA_HOST: "::::" });
    expect(resolveLocalBaseUrl(env)).toBe("http://localhost:11434");
  });

  it("rejects non-HTTP schemes and URL credentials in OLLAMA_HOST", () => {
    expect(
      resolveLocalBaseUrl(createEnvironmentReader({ OLLAMA_HOST: "ftp://x" }))
    ).toBe("http://localhost:11434");
    expect(
      resolveLocalBaseUrl(
        createEnvironmentReader({ OLLAMA_HOST: "http://user:secret@host" })
      )
    ).toBe("http://localhost:11434");
  });

  it("rejects single-slash non-HTTP schemes like file:/tmp", () => {
    expect(
      resolveLocalBaseUrl(createEnvironmentReader({ OLLAMA_HOST: "file:/tmp" }))
    ).toBe("http://localhost:11434");
  });

  it("is not registered when not opted in", () => {
    const env = createEnvironmentReader({});
    expect(createOllamaSearchProvider(env)).toBeNull();
  });

  it("uses only the cloud endpoint when local probing is disabled", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([
            { content: "cloud only", title: "Edge", url: "https://edge/" },
          ])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = createOllamaSearchProvider(env, { localEnabled: false });
    if (!provider) {
      throw new Error("Ollama provider was not enabled");
    }
    const results = await provider.search("edge query", 2);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestOf(mockFetch).url).toBe("https://ollama.com/api/web_search");
    expect(results[0]?.engine).toBe("Ollama");
  });

  it("respects OLLAMA_HOST when calling the local daemon", async () => {
    const env = enableOllamaEnv({ OLLAMA_HOST: "127.0.0.1:11434" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ content: "c", title: "t", url: "https://x/" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await provider.search("q", 5);

    expect(requestOf(mockFetch).url).toBe(
      "http://127.0.0.1:11434/api/experimental/web_search"
    );
  });

  it("tries Ollama before a configured keyed provider", async () => {
    process.env.OPENSEARCH_ENABLE_OLLAMA = "true";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([
            { content: "snippet", title: "Local", url: "https://local/" },
          ])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await nodeSearch("query", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    expect(results[0]).toMatchObject({
      engine: "Ollama",
      url: "https://local/",
    });
  });

  it("moves on to the next provider when Ollama hits the shared quota", async () => {
    process.env.OPENSEARCH_ENABLE_OLLAMA = "true";
    process.env.OLLAMA_API_KEY = "ollama-key";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      // Ollama local: 429 (shared quota).
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      )
      // Brave: succeeds.
      .mockResolvedValueOnce(
        createMockJsonResponse({
          web: {
            results: [
              {
                description: "brave snippet",
                title: "Brave",
                url: "https://brave/",
              },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await nodeSearch("query", 5);

    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    expect(requestOf(mockFetch, 1).url).toContain("api.search.brave.com");
    expect(results[0]).toMatchObject({
      engine: "Brave",
      url: "https://brave/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("is absent from the chain when not opted in", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        web: {
          results: [
            { description: "s", title: "Brave", url: "https://brave/" },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await nodeSearch("query", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestOf(mockFetch, 0).url).toContain("api.search.brave.com");
    expect(results.every((r) => r.engine !== "Ollama")).toBe(true);
  });

  it("returns null when not opted in", async () => {
    const env = createEnvironmentReader({});
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses a signed-in local daemon for batches without a cloud API key", async () => {
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { url: string };
      return createMockJsonResponse({
        content: `local:${body.url}`,
        links: [],
        title: "Local Ollama fetch",
      });
    });
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearchWithRuntime(
      {
        env: {
          OPENSEARCH_ENABLE_EXA_MCP: "false",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_OLLAMA: "true",
        },
      },
      {
        localFetch: () =>
          Promise.reject(new Error("unexpected local parser fallback")),
      }
    );
    const urls = ["https://example.com/one", "https://example.com/two"];

    const results = await client.fetch(urls, { maxConcurrency: 1 });

    expect(results.map((result) => result.content)).toEqual([
      `local:${urls[0]}`,
      `local:${urls[1]}`,
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      mockFetch.mock.calls.every(([url]) =>
        String(url).startsWith(
          "http://localhost:11434/api/experimental/web_fetch"
        )
      )
    ).toBe(true);
  });
});

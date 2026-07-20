import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearchWithRuntime,
  type OpenSearchEvent,
} from "../client.ts";
import {
  createEnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { tryFetchUrlViaOllama } from "../fetch/ollama-provider.ts";
import { createFetchResult } from "../fetch/result.ts";
import { resolveLocalBaseUrl } from "../providers/ollama/client.ts";
import { getNodeSearchProviders } from "../search/node-providers.ts";
import { createOllamaSearchProvider } from "../search/providers/ollama.ts";
import { createSearchService } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

function ollamaSearchBody(
  results: Array<{
    title?: string;
    url?: string;
    content?: string;
  }> = []
) {
  return { results };
}

function connectionRefusedError(): TypeError {
  return new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
}

function requestOf(
  mockFetch: ReturnType<typeof vi.fn>,
  index = 0
): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = mockFetch.mock.calls[index] ?? [];
  const body = init?.body;
  return {
    body: typeof body === "string" ? JSON.parse(body) : undefined,
    init: init ?? {},
    url: String(url),
  };
}

function enableOllamaEnv(overrides: Record<string, string> = {}) {
  return createEnvironmentReader({
    OPENSEARCH_ENABLE_OLLAMA: "true",
    ...overrides,
  });
}

function getOllamaSearchProvider(
  env: ReturnType<typeof createEnvironmentReader>
) {
  const provider = createOllamaSearchProvider(env);
  if (!provider) {
    throw new Error("Ollama search provider was not enabled for this test");
  }
  return provider;
}

const nodeSearch = createSearchService(processEnvironmentReader, {
  providers: getNodeSearchProviders,
}).search;

describe("Ollama client", () => {
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
});

describe("Ollama search provider", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("is not registered when not opted in", () => {
    const env = createEnvironmentReader({});
    expect(createOllamaSearchProvider(env)).toBeNull();
  });

  it("searches via the local daemon without an API key", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse(
        ollamaSearchBody([
          {
            content: "Ollama content snippet",
            title: "Ollama Docs",
            url: "https://docs.ollama.com/",
          },
        ])
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("ollama docs", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, body, init } = requestOf(mockFetch);
    expect(url).toBe("http://localhost:11434/api/experimental/web_search");
    expect(body).toEqual({ max_results: 5, query: "ollama docs" });
    expect(
      (init.headers as Record<string, string>).Authorization
    ).toBeUndefined();
    expect(results).toEqual([
      {
        engine: "Ollama",
        snippet: "Ollama content snippet",
        title: "Ollama Docs",
        url: "https://docs.ollama.com/",
      },
    ]);
  });

  it("caps max_results at the cloud API limit of 10", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ content: "c", title: "t", url: "https://x/" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await provider.search("q", 20);

    expect(requestOf(mockFetch).body).toEqual({ max_results: 10, query: "q" });
  });

  it("falls back to the cloud API when the local daemon is unreachable", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(connectionRefusedError())
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([
            { content: "snippet", title: "Cloud", url: "https://c/" },
          ])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("cloud query", 4);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    const cloud = requestOf(mockFetch, 1);
    expect(cloud.url).toBe("https://ollama.com/api/web_search");
    expect(cloud.body).toEqual({ max_results: 4, query: "cloud query" });
    expect((cloud.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ollama-key"
    );
    expect(results[0]).toMatchObject({ engine: "Ollama", url: "https://c/" });
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

  it("does not retry the cloud path on a local 429 (shared quota)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          { error: "you have reached your web search hourly request limit" },
          429
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "blocked",
      status: 429,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the cloud path when the local daemon is unsigned (401)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "Unauthorized" }, 401)
      )
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ content: "s", title: "C", url: "https://c/" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("q", 3);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 1).url).toBe(
      "https://ollama.com/api/web_search"
    );
    expect(results[0]).toMatchObject({ engine: "Ollama" });
  });

  it("reports misconfigured when the daemon is unreachable and no key is set", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockRejectedValueOnce(connectionRefusedError());
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "misconfigured",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("classifies a cloud 429 as blocked", async () => {
    const env = enableOllamaEnv({
      OLLAMA_API_KEY: "ollama-key",
      OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "blocked",
      status: 429,
    });
  });

  it("classifies a cloud 401 as misconfigured", async () => {
    const env = enableOllamaEnv({
      OLLAMA_API_KEY: "ollama-key",
      OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "Unauthorized" }, 401)
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "misconfigured",
      status: 401,
    });
  });

  it("treats an empty result set as no-results without hitting the cloud", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse(ollamaSearchBody([])));
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "no-results",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
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
});

describe("Ollama search chain integration", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
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
});

describe("Ollama fetch provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("fetches via the local daemon and truncates to maxCharacters", async () => {
    const env = enableOllamaEnv();
    const longContent = "A".repeat(50);
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        content: longContent,
        links: ["https://iana.org/domains/example"],
        title: "Example Domain",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama("https://example.com/", 10, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, body } = requestOf(mockFetch);
    expect(url).toBe("http://localhost:11434/api/experimental/web_fetch");
    expect(body).toEqual({ url: "https://example.com/" });
    expect(result).toMatchObject({
      content: "AAAAAAAAAA",
      length: 10,
      title: "Example Domain",
      url: "https://example.com/",
    });
  });

  it("falls back to the cloud path on a local connection failure", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(connectionRefusedError())
      .mockResolvedValueOnce(
        createMockJsonResponse({
          content: "cloud content",
          links: [],
          title: "Cloud",
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 1).url).toBe(
      "https://ollama.com/api/web_fetch"
    );
    expect(result).toMatchObject({ content: "cloud content", title: "Cloud" });
  });

  it("treats empty cloud fetch content as a provider miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ content: "   ", links: [], title: "Empty" })
      );
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearchWithRuntime(
      {
        env: {
          OLLAMA_API_KEY: "ollama-key",
          OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
          OPENSEARCH_ENABLE_EXA_MCP: "false",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_OLLAMA: "true",
        },
      },
      {
        localFetch: async (url) =>
          createFetchResult(url, "local fallback", "Local fallback"),
      }
    );

    const result = await client.fetch("https://example.com/empty");

    expect(result.content).toBe("local fallback");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry the cloud path after a local 429 (shared quota)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      tryFetchUrlViaOllama("https://example.com/", 1000, env)
    ).rejects.toMatchObject({ kind: "blocked", status: 429 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds Ollama response bodies before parsing JSON", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("{}", {
        headers: { "Content-Length": String(10 * 1024 * 1024 + 1) },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      tryFetchUrlViaOllama("https://example.com/", 1000, env)
    ).rejects.toMatchObject({ kind: "transient" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when the daemon is unreachable and no key is set", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockRejectedValueOnce(connectionRefusedError());
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(result).toBeNull();
  });

  it("records a shared-quota failure and falls back through the core chain", async () => {
    const events: OpenSearchEvent[] = [];
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      );
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearchWithRuntime(
      {
        env: {
          OLLAMA_API_KEY: "ollama-key",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_OLLAMA: "true",
        },
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      {
        localFetch: async (url) =>
          createFetchResult(url, "local fallback", "Local fallback"),
      }
    );

    const result = await client.fetch("https://example.com/quota");

    expect(result.content).toBe("local fallback");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureKind: "blocked",
          phase: "failure",
          provider: "ollama",
          status: 429,
          type: "provider",
        }),
        expect.objectContaining({
          fromProvider: "ollama",
          toProvider: "local",
          type: "fallback",
        }),
      ])
    );
  });

  it("honors batch concurrency when the cloud provider is enabled", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      const body = JSON.parse(String(init?.body)) as { url: string };
      return createMockJsonResponse({
        content: `content:${body.url}`,
        links: [],
        title: "Cloud fetch",
      });
    });
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearchWithRuntime(
      {
        env: {
          OLLAMA_API_KEY: "ollama-key",
          OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_OLLAMA: "true",
        },
      },
      {
        localFetch: async (url) =>
          createFetchResult(url, "unexpected fallback"),
      }
    );
    const urls = Array.from(
      { length: 5 },
      (_value, index) => `https://example.com/${index}`
    );

    const results = await client.fetch(urls, { maxConcurrency: 2 });

    expect(results).toHaveLength(5);
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(maxActiveRequests).toBe(2);
  });

  it("preserves downstream native batching for Ollama misses", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        createMockJsonResponse({ content: "", links: [], title: "Empty" })
      );
    vi.stubGlobal("fetch", mockFetch);
    const fetchBatch = vi.fn(async (batchUrls: string[]) =>
      batchUrls.map((url) => ({
        content: `exa:${url}`,
        title: "Exa batch",
        url,
      }))
    );
    const fetchUrl = vi.fn();
    const client = createOpenSearchWithRuntime(
      {
        env: {
          OLLAMA_API_KEY: "ollama-key",
          OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
          OPENSEARCH_ENABLE_FIRECRAWL: "false",
          OPENSEARCH_ENABLE_OLLAMA: "true",
        },
      },
      {
        exaMcpFetchProvider: {
          fetchBatch,
          fetchUrl,
          isEnabled: () => true,
        },
      }
    );
    const urls = [
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
    ];

    const results = await client.fetch(urls, { maxConcurrency: 2 });

    expect(mockFetch).toHaveBeenCalledTimes(urls.length);
    expect(fetchBatch).toHaveBeenCalledOnce();
    expect(fetchBatch).toHaveBeenCalledWith(urls, 12_000, expect.anything());
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(results.map((result) => result.content)).toEqual(
      urls.map((url) => `exa:${url}`)
    );
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

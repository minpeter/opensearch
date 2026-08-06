import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOpenSearchWithRuntime,
  type OpenSearchEvent,
} from "../client.ts";
import { tryFetchUrlViaOllama } from "../fetch/ollama-provider.ts";
import { createFetchResult } from "../fetch/result.ts";
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

beforeEach(() => {
  resetSearchEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSearchEnv();
});

describe("Ollama routing and results", () => {
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
});

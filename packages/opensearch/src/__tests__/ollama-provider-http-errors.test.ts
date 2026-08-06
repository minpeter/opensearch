import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tryFetchUrlViaOllama } from "../fetch/ollama-provider.ts";
import {
  connectionRefusedError,
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

describe("Ollama HTTP and error handling", () => {
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
});

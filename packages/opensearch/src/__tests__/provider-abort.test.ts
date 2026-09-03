import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiKeyPool } from "../credentials/api-key-pool.ts";
import type { EnvironmentReader } from "../environment.ts";
import { fetchExaApiBatchWithPool } from "../fetch/exa-api.ts";
import { requestFirecrawlJson } from "../providers/firecrawl/request.ts";
import { createTinyFishApiKeyPool } from "../providers/tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../providers/tinyfish/fetch.ts";
import { createDataForSeoProvider } from "../search/providers/serp/dataforseo.ts";

function envWith(values: Readonly<Record<string, string>>): EnvironmentReader {
  return { read: (key: string) => values[key] };
}

describe("provider request cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the caller reason when DataForSEO is aborted while reading the response body", async () => {
    // Given
    const abortController = new AbortController();
    const reason = new Error("caller cancelled DataForSEO");
    let requestSignal: AbortSignal | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                bodyController = controller;
                requestSignal?.addEventListener(
                  "abort",
                  () => controller.close(),
                  { once: true }
                );
              },
            })
          )
        );
      })
    );
    const provider = createDataForSeoProvider(
      envWith({
        DATAFORSEO_LOGIN: "login",
        DATAFORSEO_PASSWORD: "password",
      })
    );
    if (!provider) {
      throw new Error("expected configured DataForSEO provider");
    }

    // When
    const search = provider.search("abort body", 1, abortController.signal);
    abortController.abort(reason);
    if (!requestSignal?.aborted) {
      bodyController?.error(new Error("caller signal was not propagated"));
    }

    // Then
    await expect(search).rejects.toBe(reason);
  });

  it("stops TinyFish API key rotation when the caller aborts", async () => {
    // Given
    const abortController = new AbortController();
    const reason = new Error("caller cancelled TinyFish");
    const fetchMock = vi.fn(() => {
      abortController.abort(reason);
      return Promise.resolve(new Response("", { status: 429 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const apiKeyPool = createTinyFishApiKeyPool(
      envWith({ TINYFISH_API_KEY: "tiny-a;tiny-b" })
    );

    // When
    const request = fetchTinyFishUrls(
      ["https://example.com"],
      apiKeyPool,
      abortController.signal
    );

    // Then
    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops Firecrawl API key rotation when the caller aborts", async () => {
    // Given
    const abortController = new AbortController();
    const reason = new Error("caller cancelled Firecrawl");
    const fetchMock = vi.fn(() => {
      abortController.abort(reason);
      return Promise.resolve(new Response("", { status: 429 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    // When
    const request = requestFirecrawlJson({
      body: {},
      endpoint: "search",
      env: envWith({ FIRECRAWL_API_KEY: "fire-a;fire-b" }),
      signal: abortController.signal,
      useApiKey: true,
    });

    // Then
    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops Exa REST API key rotation when the caller aborts", async () => {
    // Given
    const abortController = new AbortController();
    const reason = new Error("caller cancelled Exa REST fetch");
    const fetchMock = vi.fn(() => {
      abortController.abort(reason);
      return Promise.resolve(new Response("", { status: 429 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const apiKeyPool = createApiKeyPool(
      "EXA_API_KEY",
      envWith({ EXA_API_KEY: "exa-a;exa-b" })
    );

    // When
    const request = fetchExaApiBatchWithPool(
      ["https://example.com"],
      1000,
      apiKeyPool,
      abortController.signal
    );

    // Then
    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

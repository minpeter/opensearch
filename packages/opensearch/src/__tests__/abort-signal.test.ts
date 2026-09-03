import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenSearch, search } from "../node.ts";
import { SearchEngineError } from "../search/errors.ts";
import { fetchSearchText } from "../search/http.ts";
import { createSearchService } from "../search.ts";

const pendingResponse = (
  signal: AbortSignal | null | undefined
): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
      { once: true }
    );
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("per-call AbortSignal", () => {
  it("aborts the default Node fetch boundary", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return pendingResponse(init?.signal);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createOpenSearch({
      fetch: { allowPrivateNetwork: true, cache: { enabled: false } },
    });
    const operation = client.fetch("http://127.0.0.1/abort-fetch", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("aborts the default Node search boundary without starting fallback work", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return pendingResponse(init?.signal);
    });
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchSpy);

    const operation = search("abort-search", 3, { signal: controller.signal });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects pre-aborted calls without invoking a provider", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = vi.fn(async () => []);
    const service = createSearchService(
      { read: () => undefined },
      {
        providers: () => [{ name: "Brave", search: provider }],
      }
    );

    await expect(
      service.searchWithRetryAndCache("pre-aborted", 3, {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("stops retry backoff and fallback classification after caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fallback = vi.fn(async () => []);
    const first = vi.fn(() => {
      throw new SearchEngineError("Brave", "transient", "temporary");
    });
    const service = createSearchService(
      { read: () => undefined },
      {
        providers: () => [
          { name: "Brave", search: first },
          { name: "Exa", search: fallback },
        ],
      }
    );

    await expect(
      service.searchWithRetryAndCache("retry-aborted", 3, {
        cache: "bypass",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("aborts a stalled response body and cleans up its timeout listener", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start: () => undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body))
    );
    const operation = fetchSearchText({
      engine: "Brave",
      init: {},
      signal: controller.signal,
      url: "https://example.com/search",
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not cancel shared cached work for an unrelated caller", async () => {
    const controller = new AbortController();
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => undefined, {
          once: true,
        });
        return response;
      })
    );
    const client = createOpenSearch({
      fetch: { allowPrivateNetwork: true },
    });
    const first = client.fetch("http://127.0.0.1/shared", {
      signal: controller.signal,
    });
    const second = client.fetch("http://127.0.0.1/shared");
    controller.abort();
    resolveResponse?.(
      new Response(
        "<html><title>shared</title><body>shared content</body></html>",
        {
          status: 200,
        }
      )
    );

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({
      url: "http://127.0.0.1/shared",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenSearch, search } from "../node.ts";
import { SearchExecutionError } from "../search/errors.ts";
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
    const started = Promise.withResolvers<void>();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      started.resolve();
      return pendingResponse(init?.signal);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createOpenSearch({
      fetch: { allowPrivateNetwork: true, cache: { enabled: false } },
    });
    const operation = client.fetch("http://127.0.0.1/abort-fetch", {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("aborts the default Node search boundary without starting fallback work", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      started.resolve();
      return pendingResponse(init?.signal);
    });
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchSpy);

    const operation = search("abort-search", 3, { signal: controller.signal });
    await started.promise;
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

  it("preserves a null reason for pre-aborted public searches", async () => {
    const controller = new AbortController();
    controller.abort(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = createOpenSearch({ env: { TAVILY_API_KEY: "test-key" } });

    await expect(
      search("module null abort", 1, { signal: controller.signal })
    ).rejects.toBe(null);
    await expect(
      client.search("client null abort", 1, { signal: controller.signal })
    ).rejects.toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([1, 4])(
    "uses and removes one abort listener for each of %i cached calls sharing a signal",
    async (callCount) => {
      // Given
      const controller = new AbortController();
      const providerResult =
        Promise.withResolvers<
          Awaited<ReturnType<ReturnType<typeof createSearchService>["search"]>>
        >();
      const provider = vi.fn(() => providerResult.promise);
      const service = createSearchService(
        { read: () => undefined },
        {
          providers: () => [{ name: "Brave", search: provider }],
        }
      );
      const addEventListener = vi.spyOn(controller.signal, "addEventListener");
      const removeEventListener = vi.spyOn(
        controller.signal,
        "removeEventListener"
      );

      // When
      const calls = Array.from({ length: callCount }, () =>
        service.searchWithRetryAndCache("shared-listener-count", 1, {
          signal: controller.signal,
        })
      );
      providerResult.resolve([
        {
          engine: "Brave",
          snippet: "result",
          title: "Result",
          url: "https://example.com/result",
        },
      ]);
      await Promise.all(calls);

      // Then
      expect(provider).toHaveBeenCalledOnce();
      expect(
        addEventListener.mock.calls.filter(([type]) => type === "abort")
      ).toHaveLength(callCount);
      expect(
        removeEventListener.mock.calls.filter(([type]) => type === "abort")
      ).toHaveLength(callCount);
    }
  );

  it("removes one listener per shared cached call after cancellation", async () => {
    // Given
    const controller = new AbortController();
    const reason = new Error("all shared callers left");
    const provider = vi.fn(
      (_query: string, _maxResults: number, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        })
    );
    const service = createSearchService(
      { read: () => undefined },
      {
        providers: () => [{ name: "Brave", search: provider }],
      }
    );
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener"
    );
    const calls = Array.from({ length: 4 }, () =>
      service.searchWithRetryAndCache("shared-cancellation", 1, {
        signal: controller.signal,
      })
    );

    // When
    controller.abort(reason);

    // Then
    await Promise.all(calls.map((call) => expect(call).rejects.toBe(reason)));
    expect(provider).toHaveBeenCalledOnce();
    expect(
      addEventListener.mock.calls.filter(([type]) => type === "abort")
    ).toHaveLength(4);
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === "abort")
    ).toHaveLength(4);
  });

  it("stops retry backoff and fallback classification after caller abort", async () => {
    const controller = new AbortController();
    const firstStarted = Promise.withResolvers<void>();
    const fallback = vi.fn(async () => []);
    const first = vi.fn(() => {
      firstStarted.resolve();
      throw new SearchExecutionError("temporary", true);
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

    const operation = service.searchWithRetryAndCache("retry-aborted", 3, {
      cache: "bypass",
      signal: controller.signal,
    });
    await firstStarted.promise;

    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledOnce();
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

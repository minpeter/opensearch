import { afterEach, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("cancels a nested Hacker News response body when the caller aborts", async () => {
  const controller = new AbortController();
  const callerAbort = new Error("caller stopped public API fetch");
  let markNestedRequestStarted: (() => void) | undefined;
  const nestedRequestStarted = new Promise<void>((resolve) => {
    markNestedRequestStarted = resolve;
  });
  let requestCount = 0;
  const mockFetch = vi.fn(
    (_input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify([100]), { status: 200 });
      }

      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(streamController) {
            signal?.addEventListener(
              "abort",
              () => streamController.error(signal.reason),
              { once: true }
            );
            markNestedRequestStarted?.();
          },
        }),
        { status: 200 }
      );
    }
  );
  vi.stubGlobal("fetch", mockFetch);

  const operation = fetchViaPublicApi(
    "https://news.ycombinator.com/news",
    controller.signal
  );
  await nestedRequestStarted;
  controller.abort(callerAbort);

  await expect(operation).rejects.toBe(callerAbort);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
});

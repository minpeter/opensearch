import { afterEach, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("cancels a nested Hacker News response body when the caller aborts", async () => {
  // Given
  const controller = new AbortController();
  const callerAbort = new Error("caller stopped public API fetch");
  const readStarted = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const cancel = vi.fn(() => {
    cancelled.resolve();
  });
  let body: ReadableStream<Uint8Array>;
  body = new ReadableStream<Uint8Array>({
    cancel,
    pull() {
      if (body.locked) {
        readStarted.resolve();
      }
    },
  });
  const mockFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([100]), { status: 200 }))
    .mockResolvedValueOnce(new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", mockFetch);

  // When
  const operation = fetchViaPublicApi(
    "https://news.ycombinator.com/news",
    controller.signal
  );
  await readStarted.promise;
  controller.abort(callerAbort);

  // Then
  await expect(operation).rejects.toBe(callerAbort);
  await cancelled.promise;
  expect(cancel).toHaveBeenCalledWith(callerAbort);
  expect(body.locked).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

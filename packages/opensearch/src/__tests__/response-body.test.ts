import { describe, expect, it, vi } from "vitest";

import {
  cancelResponseBody,
  limitResponseBody,
  ResponseSizeLimitError,
  readResponseBytes,
  readResponseJson,
  readResponseText,
} from "../response-body.ts";

describe("bounded response body readers", () => {
  it("does not let cancellation failures replace the provider error", async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("cleanup failed");
        },
      })
    );

    await expect(cancelResponseBody(response)).resolves.toBeUndefined();
  });

  it("preserves streaming delivery instead of buffering the full response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });

    const boundedResponse = await limitResponseBody(new Response(stream), 3);
    const reader = boundedResponse.body?.getReader();

    await expect(reader?.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1, 2]),
    });
    await reader?.cancel();
  });

  it("rejects an oversized declared content length before buffering", async () => {
    const response = new Response("small", {
      headers: { "Content-Length": "101" },
    });

    await expect(readResponseBytes(response, 100)).rejects.toEqual(
      new ResponseSizeLimitError(100)
    );
  });

  it("rejects a streamed body when chunks cross the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    const response = new Response(stream);

    await expect(readResponseBytes(response, 3)).rejects.toBeInstanceOf(
      ResponseSizeLimitError
    );
  });

  it("remains abortable and releases the reader when oversized cancellation stalls", async () => {
    // Given: an oversized stream whose cancellation never settles.
    const controller = new AbortController();
    const reason = new Error("caller stopped stalled cancellation");
    const cancellationStarted = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellationStarted.resolve();
        return new Promise<void>(() => undefined);
      },
      start(streamController) {
        streamController.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
    });

    // When: the caller aborts after oversized-body cancellation starts.
    const reading = readResponseBytes(new Response(body), 3, controller.signal);
    await cancellationStarted.promise;
    controller.abort(reason);

    // Then: caller cancellation wins and releases the stream lock.
    await expect(reading).rejects.toBe(reason);
    expect(body.locked).toBe(false);
  });

  it("preserves the size error when reader cancellation rejects", async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error("cleanup failed"));
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
    });

    await expect(
      readResponseBytes(new Response(body), 3)
    ).rejects.toBeInstanceOf(ResponseSizeLimitError);
    expect(body.locked).toBe(false);
  });

  it("remains abortable when declared-length cancellation stalls", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped declared-length cancellation");
    const cancellationStarted = Promise.withResolvers<void>();
    const response = new Response(new ReadableStream<Uint8Array>(), {
      headers: { "Content-Length": "4" },
    });
    const { body } = response;
    if (!body) {
      throw new Error("Expected response body");
    }
    const cancel = vi.spyOn(body, "cancel").mockImplementation(() => {
      cancellationStarted.resolve();
      return new Promise<void>(() => undefined);
    });

    const reading = readResponseBytes(response, 3, controller.signal);
    await cancellationStarted.promise;
    controller.abort(reason);

    await expect(reading).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("applies limits to encoded bytes rather than UTF-16 characters", async () => {
    await expect(
      readResponseText(new Response("éé"), 3)
    ).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });

  it("parses JSON only after the bounded read succeeds", async () => {
    await expect(
      readResponseJson(new Response('{"ok":true}'), 64)
    ).resolves.toEqual({ ok: true });
  });

  it("aborts a stalled response body with the caller reason", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    const cancelled = Promise.withResolvers<void>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled.resolve();
        },
        start: () => undefined,
      })
    );

    const reading = readResponseBytes(response, 64, controller.signal);
    controller.abort(reason);

    await expect(reading).rejects.toBe(reason);
    await expect(cancelled.promise).resolves.toBeUndefined();
  });
});

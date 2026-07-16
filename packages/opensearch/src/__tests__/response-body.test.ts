import { describe, expect, it } from "vitest";

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
});

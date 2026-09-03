import { expect, it, vi } from "vitest";
import { readResponseBytes } from "../response-body.ts";

it("cancels an active response body and releases its reader on caller abort", async () => {
  const controller = new AbortController();
  const callerAbort = new Error("caller stopped response body");
  const readStarted = Promise.withResolvers<void>();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    cancel,
    pull() {
      readStarted.resolve();
    },
  });
  const response = new Response(body);

  const operation = readResponseBytes(response, 1024, controller.signal);
  await readStarted.promise;
  controller.abort(callerAbort);

  await expect(operation).rejects.toBe(callerAbort);
  expect(cancel).toHaveBeenCalledWith(callerAbort);
  expect(body.locked).toBe(false);
});

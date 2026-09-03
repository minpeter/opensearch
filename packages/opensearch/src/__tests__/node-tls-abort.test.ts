import { expect, it, vi } from "vitest";
import { fetchViaTlsImpersonation } from "../node/tls-executor.ts";

it("preserves the caller abort when the TLS loader settles after cancellation", async () => {
  const controller = new AbortController();
  const callerAbort = new Error("caller stopped TLS loader");
  const loaderStarted = Promise.withResolvers<void>();
  const loaderResult = Promise.withResolvers<never>();
  const loader = vi.fn(() => {
    loaderStarted.resolve();
    return loaderResult.promise;
  });

  const operation = fetchViaTlsImpersonation("https://example.com", {
    enabled: true,
    loader,
    signal: controller.signal,
  });
  await loaderStarted.promise;
  controller.abort(callerAbort);
  loaderResult.reject(new Error("late loader failure"));

  await expect(operation).rejects.toBe(callerAbort);
  expect(loader).toHaveBeenCalledOnce();
});

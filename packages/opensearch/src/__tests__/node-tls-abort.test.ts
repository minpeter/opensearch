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
  await expect(operation).rejects.toBe(callerAbort);

  loaderResult.reject(new Error("late loader failure"));
  expect(loader).toHaveBeenCalledOnce();
});

it("does not start profile or request work after cancellation", async () => {
  const controller = new AbortController();
  const callerAbort = new Error("caller stopped profile discovery");
  const profilesResult = Promise.withResolvers<readonly string[]>();
  const profileStarted = Promise.withResolvers<void>();
  const fetchImpl = vi.fn();
  const getProfiles = vi.fn(() => {
    profileStarted.resolve();
    return profilesResult.promise;
  });
  const loader = vi.fn(async () => ({
    fetch: fetchImpl,
    getProfiles,
  }));

  const operation = fetchViaTlsImpersonation("https://example.com", {
    enabled: true,
    loader,
    signal: controller.signal,
  });
  await profileStarted.promise;
  controller.abort(callerAbort);
  await expect(operation).rejects.toBe(callerAbort);

  profilesResult.resolve(["chrome_131"]);
  expect(getProfiles).toHaveBeenCalledOnce();
  expect(fetchImpl).not.toHaveBeenCalled();
});

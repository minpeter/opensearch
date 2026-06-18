import { describe, expect, it, vi } from "vitest";
import {
  fetchViaTlsImpersonation,
  tlsImpersonationEnabled,
  type WreqLoader,
} from "../node/tls-executor.ts";

function loaderWithFetch(
  fetchImpl: Awaited<ReturnType<WreqLoader>>["fetch"],
  profiles: readonly string[] = ["chrome_131", "chrome_142"]
): WreqLoader {
  return async () => ({
    fetch: fetchImpl,
    getProfiles: () => profiles,
  });
}

describe("tlsImpersonationEnabled", () => {
  it("requires an explicit env opt-in", () => {
    expect(tlsImpersonationEnabled({})).toBe(false);
    expect(
      tlsImpersonationEnabled({ OPENSEARCH_ENABLE_TLS_IMPERSONATION: "true" })
    ).toBe(true);
  });
});

describe("fetchViaTlsImpersonation", () => {
  it("returns an unavailable trace when disabled", async () => {
    const result = await fetchViaTlsImpersonation("https://example.com");

    expect(result.response).toBeUndefined();
    expect(result.trace[0]).toMatchObject({
      name: "tls:wreq-js:unavailable",
      verdict: "unknown",
    });
  });

  it("returns an unavailable trace when the adapter cannot load", async () => {
    const result = await fetchViaTlsImpersonation("https://example.com", {
      enabled: true,
      loader: () => Promise.reject(new Error("missing optional dependency")),
    });

    expect(result.summary).toBe("missing optional dependency");
    expect(result.trace[0]?.summary).toBe("missing optional dependency");
  });

  it("maps browser profile, referer, timeout, and trace on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: new Headers({ "content-type": "text/html" }),
      status: 200,
      text: async () => "<article>Loaded content</article>",
    });

    const result = await fetchViaTlsImpersonation("https://example.com/a", {
      enabled: true,
      loader: loaderWithFetch(fetchImpl),
      referer: "https://example.com/",
      timeoutMs: 1234,
    });

    expect(result.response?.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/a",
      expect.objectContaining({
        browser: "chrome_131",
        headers: expect.objectContaining({
          Referer: "https://example.com/",
        }),
        signal: expect.any(AbortSignal),
      })
    );
    expect(result.trace[0]).toMatchObject({
      executor: "wreq-js",
      name: "tls:wreq-js:chrome_131",
      profileUsed: "tls:chrome_131",
      verdict: "weak_ok",
    });
  });

  it("tries the next profile after a challenge", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        headers: new Headers({ server: "cloudflare" }),
        status: 200,
        text: async () => "<html>Just a moment...</html>",
      })
      .mockResolvedValueOnce({
        headers: new Headers({ "content-type": "text/html" }),
        status: 200,
        text: async () => "<main>Recovered content</main>",
      });

    const result = await fetchViaTlsImpersonation("https://example.com/a", {
      enabled: true,
      loader: loaderWithFetch(fetchImpl, ["chrome_131", "chrome_142"]),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.response?.status).toBe(200);
    expect(result.trace.map((attempt) => attempt.profileUsed)).toEqual([
      "tls:chrome_131",
      "tls:chrome_142",
    ]);
  });
});

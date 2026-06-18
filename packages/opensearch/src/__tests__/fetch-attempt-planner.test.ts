import { describe, expect, it, vi } from "vitest";
import {
  type AttemptExecutorInput,
  runAttemptPlan,
} from "../fetch/attempt-planner.ts";

describe("runAttemptPlan", () => {
  it("validates the first 200 response before accepting it", async () => {
    const executor = vi.fn().mockResolvedValue({
      body: '<main id="content">Loaded</main>',
      response: "ok",
      status: 200,
    });

    const result = await runAttemptPlan("https://example.com/a", {
      executor,
      successSelectors: ["#content"],
    });

    expect(result.response).toBe("ok");
    expect(result.verdict).toBe("strong_ok");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      name: "probe:original",
      phase: "probe",
      urlTransform: "original",
      verdict: "strong_ok",
    });
  });

  it("continues the bounded grid until a weak success", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce({
        body: "<html><title>Just a moment...</title></html>",
        headers: { server: "cloudflare" },
        response: "challenge",
        status: 200,
      })
      .mockResolvedValueOnce({
        body: `<article>${"content ".repeat(500)}</article>`,
        response: "mobile",
        status: 200,
      });

    const result = await runAttemptPlan("https://www.example.com/a", {
      executor,
      maxAttempts: 2,
    });

    expect(result.response).toBe("mobile");
    expect(result.verdict).toBe("weak_ok");
    expect(result.trace.map((attempt) => attempt.urlTransform)).toEqual([
      "original",
      "mobile_subdomain",
    ]);
  });

  it("records errors and stops at the max attempt bound", async () => {
    const executor = vi.fn((input: AttemptExecutorInput) => {
      if (input.phase === "probe") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({
        body: "blocked",
        response: input.url,
        status: 403,
      });
    });

    const result = await runAttemptPlan("https://www.example.com/a", {
      executor,
      maxAttempts: 2,
    });

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.response).toBeUndefined();
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0]?.verdict).toBe("unknown");
    expect(result.trace[1]?.status).toBe(403);
  });

  it("emits an API-discovery hint after repeated profiled collection challenges", async () => {
    const executor = vi.fn().mockResolvedValue({
      body: "<html>Just a moment...</html>",
      cookies: { __cf_bm: "token" },
      headers: { server: "cloudflare", "cf-ray": "abc" },
      response: "blocked",
      status: 200,
    });

    const result = await runAttemptPlan("https://example.com/search?q=items", {
      executor,
      maxAttempts: 2,
    });

    expect(result.response).toBeUndefined();
    expect(result.summary).toContain("api_discovery_hint");
    expect(result.trace.map((attempt) => attempt.profileUsed)).toContain(
      "cloudflare_turnstile"
    );
  });

  it("does not emit an API-discovery hint for a single document lookup", async () => {
    const executor = vi.fn().mockResolvedValue({
      body: "<html>Just a moment...</html>",
      cookies: { __cf_bm: "token" },
      headers: { "cf-ray": "abc", server: "cloudflare" },
      response: "blocked",
      status: 200,
    });

    const result = await runAttemptPlan("https://example.com/articles/one", {
      executor,
      maxAttempts: 2,
    });

    expect(result.summary).toBeUndefined();
  });
});

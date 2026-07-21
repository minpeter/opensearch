import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaHttpError } from "../providers/ollama/config.ts";
import { postOllamaJson } from "../providers/ollama/http.ts";

describe("postOllamaJson Retry-After handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses delta-seconds Retry-After values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("slow down", {
          headers: { "retry-after": "120" },
          status: 429,
        })
      )
    );

    const error = await postOllamaJson(
      "https://ollama.com/api/web_search",
      {},
      { label: "test", schema: z.object({}), timeoutMs: 1000 }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OllamaHttpError);
    expect((error as OllamaHttpError).retryAfterSeconds).toBe(120);
  });

  it("parses HTTP-date Retry-After values into remaining seconds", async () => {
    const retryDate = new Date(Date.now() + 45_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("slow down", {
          headers: { "retry-after": retryDate.toUTCString() },
          status: 429,
        })
      )
    );

    const error = await postOllamaJson(
      "https://ollama.com/api/web_search",
      {},
      { label: "test", schema: z.object({}), timeoutMs: 1000 }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OllamaHttpError);
    const seconds = (error as OllamaHttpError).retryAfterSeconds;
    expect(seconds).toBeGreaterThan(30);
    expect(seconds).toBeLessThanOrEqual(45);
  });

  it("returns null for unparseable Retry-After values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("slow down", {
          headers: { "retry-after": "not-a-date" },
          status: 429,
        })
      )
    );

    const error = await postOllamaJson(
      "https://ollama.com/api/web_search",
      {},
      { label: "test", schema: z.object({}), timeoutMs: 1000 }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OllamaHttpError);
    expect((error as OllamaHttpError).retryAfterSeconds).toBeNull();
  });
});

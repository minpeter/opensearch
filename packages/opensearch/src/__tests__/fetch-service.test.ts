import { describe, expect, it, vi } from "vitest";
import type { FetchOperations } from "../fetch/orchestration.ts";
import type { FetchResult } from "../fetch/result.ts";
import { createFetchServiceForOperations } from "../fetch-service.ts";
import { createOpenSearchObserver } from "../observability.ts";

const CACHE_OPTIONS = { enabled: true, maxEntries: 16, ttlMs: 60_000 };

function resultFor(url: string): FetchResult {
  return { content: `content for ${url}`, length: 10, title: "t", url };
}

function operationsReturning(results: FetchResult[]): FetchOperations {
  return {
    fetchUrl: vi.fn(),
    fetchUrls: vi.fn().mockResolvedValue(results),
  };
}

describe("fetchUrlsWithCache result mapping", () => {
  it("maps results back to requested URLs when the provider canonicalizes them", async () => {
    const operations = operationsReturning([
      resultFor("https://a.example/"),
      resultFor("https://canonical.example/"),
    ]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    const results = await service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);

    expect(results.map((result) => result.content)).toEqual([
      "content for https://a.example/",
      "content for https://canonical.example/",
    ]);
  });

  it("keys the populated cache by the requested URL, not the canonical one", async () => {
    const operations = operationsReturning([
      resultFor("https://a.example/"),
      resultFor("https://canonical.example/"),
    ]);
    const service = createFetchServiceForOperations(
      operations,
      4,
      CACHE_OPTIONS,
      createOpenSearchObserver()
    );

    await service.fetchUrlsWithCache([
      "https://a.example/",
      "https://b.example/",
    ]);
    const cached = await service.fetchUrlWithCache("https://b.example/");

    expect(cached.content).toBe("content for https://canonical.example/");
    expect(operations.fetchUrl).not.toHaveBeenCalled();
  });
});

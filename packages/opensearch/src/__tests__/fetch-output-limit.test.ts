import { describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { createFetchResult } from "../fetch/result.ts";
import { createFetchService } from "../fetch.ts";

const DEFAULT_MAX_CHARACTERS = 12_000;
const FIXTURE_CHARACTERS = 20_000;
const FIXTURE_CONTENT = "x".repeat(FIXTURE_CHARACTERS);

function createFixtureService() {
  const localFetch = vi.fn(async (url: string) =>
    createFetchResult(url, FIXTURE_CONTENT, "Fixture title")
  );
  const env = createEnvironmentReader({
    OPENSEARCH_ENABLE_EXA_MCP: "false",
    OPENSEARCH_ENABLE_FIRECRAWL: "false",
  });

  return {
    localFetch,
    service: createFetchService(env, { localFetch }),
  };
}

describe("fetch output limits", () => {
  it("enforces an explicit limit after a single-page fallback", async () => {
    const { service } = createFixtureService();

    const result = await service.fetch("https://example.com/single", {
      maxCharacters: 1000,
    });

    expect(result).toEqual({
      content: "x".repeat(1000),
      length: 1000,
      title: "Fixture title",
      url: "https://example.com/single",
    });
  });

  it("enforces an explicit limit for every batch result", async () => {
    const { service } = createFixtureService();
    const urls = ["https://example.com/one", "https://example.com/two"];

    const results = await service.fetch(urls, { maxCharacters: 1000 });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.url)).toEqual(urls);
    expect(
      results.every(
        (result) => result.content.length === 1000 && result.length === 1000
      )
    ).toBe(true);
  });

  it("enforces and caches the documented default limit", async () => {
    const { localFetch, service } = createFixtureService();
    const url = "https://example.com/default";

    const firstResult = await service.fetch(url);
    const cachedResult = await service.fetch(url);

    expect(firstResult.content).toHaveLength(DEFAULT_MAX_CHARACTERS);
    expect(firstResult.length).toBe(DEFAULT_MAX_CHARACTERS);
    expect(cachedResult).toEqual(firstResult);
    expect(localFetch).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maxCharacters value %s",
    async (maxCharacters) => {
      const { service } = createFixtureService();

      await expect(
        service.fetch("https://example.com/invalid", { maxCharacters })
      ).rejects.toThrow("maxCharacters must be a positive safe integer");
    }
  );

  it("validates a limit even when the URL batch is empty", async () => {
    const { service } = createFixtureService();

    await expect(service.fetch([], { maxCharacters: 0 })).rejects.toThrow(
      "maxCharacters must be a positive safe integer"
    );
  });
});

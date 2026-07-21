import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../search/types.ts";

const providerSearch = vi.fn();

vi.mock("../search/providers.ts", () => ({
  getSearchProviders: () => [
    {
      name: "Brave",
      search: providerSearch,
    },
  ],
}));

function results(): SearchResult[] {
  return [
    { engine: "Brave", snippet: "s", title: "t", url: "https://example.com" },
  ];
}

describe("module-level search cache behavior", () => {
  beforeEach(() => {
    providerSearch.mockReset();
    providerSearch.mockImplementation(() => Promise.resolve(results()));
  });

  it("caches repeat searches with the same query", async () => {
    const { search } = await import("../search.ts");

    await search("cache me", 3);
    await search("cache me", 3);

    expect(providerSearch).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when the caller opts out", async () => {
    const { searchWithRetryAndCache } = await import("../search.ts");

    await searchWithRetryAndCache("skip cache", 3, { cache: "bypass" });
    await searchWithRetryAndCache("skip cache", 3, { cache: "bypass" });

    expect(providerSearch).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { SearchEngineError } from "../search/errors.ts";
import type { SearchProvider } from "../search/types.ts";
import { createSearchService } from "../search.ts";

describe("search legal restrictions", () => {
  it("does not retry or fall back after an HTTP 451 response", async () => {
    const legalRestriction = new SearchEngineError(
      "Firecrawl",
      "blocked",
      "Unavailable for legal reasons",
      { status: 451 }
    );
    const restrictedSearch = vi.fn().mockRejectedValue(legalRestriction);
    const fallbackSearch = vi.fn().mockResolvedValue([]);
    const providers: SearchProvider[] = [
      { name: "Firecrawl", search: restrictedSearch },
      { name: "DuckDuckGo", search: fallbackSearch },
    ];
    const service = createSearchService(createEnvironmentReader({}), {
      providers: () => providers,
    });

    await expect(
      service.searchWithRetryAndCache("legally restricted", 1)
    ).rejects.toBe(legalRestriction);
    expect(restrictedSearch).toHaveBeenCalledTimes(1);
    expect(fallbackSearch).not.toHaveBeenCalled();
  });
});

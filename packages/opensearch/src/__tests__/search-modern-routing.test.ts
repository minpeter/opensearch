import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSerpProviders } from "../search/providers/serp.ts";
import { search } from "../search.ts";
import { createMockResponse, resetSearchEnv } from "./search-test-helpers.ts";

describe("modern search routing", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("ignores retired Azure Bing Web Search API credentials", async () => {
    process.env.BING_SEARCH_API_KEY = "retired-bing-key";

    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse(`
        <div id="links">
          <div class="result results_links">
            <h2 class="result__title">
              <a class="result__a" href="https://example.com/duckduckgo">DuckDuckGo</a>
            </h2>
            <a class="result__a" href="https://example.com/duckduckgo">DuckDuckGo</a>
            <div class="result__snippet">Public fallback should run first.</div>
          </div>
        </div>
      `)
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("modern free search", 1);

    expect(results).toEqual([
      {
        engine: "DuckDuckGo",
        snippet: "Public fallback should run first.",
        title: "DuckDuckGo",
        url: "https://example.com/duckduckgo",
      },
    ]);
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("html.duckduckgo.com/html");
    expect(requestedUrls.join("\n")).not.toContain("api.bing.microsoft.com");
  });

  it("does not register the retired Azure Bing Web Search API adapter", () => {
    process.env.BING_SEARCH_API_KEY = "retired-bing-key";

    expect(createSerpProviders()).toEqual([]);
  });

  it("does not revive removed Google HTML scrape fallback via env", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse("<form id='challenge-form' />"))
      .mockResolvedValueOnce(
        createMockResponse("One last step: verify you are a human")
      )
      .mockResolvedValueOnce(
        createMockResponse(
          "<div class='g'><a href='https://google.example'><h3>Google</h3></a></div>"
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("removed google scrape", 1)).rejects.toThrow(
      "DuckDuckGo, Bing"
    );
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.join("\n")).not.toContain("google.com/search");
  });
});

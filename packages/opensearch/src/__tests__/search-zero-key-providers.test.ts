import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZeroKeyProviders } from "../search/providers-zero-key.ts";
import {
  parseStartpageResults,
  parseWebcrawlerResults,
} from "../search/zero-key-parsers.ts";
import { search } from "../search.ts";
import { createMockResponse, resetSearchEnv } from "./search-test-helpers.ts";

describe("zero-key public providers", () => {
  beforeEach(() => {
    resetSearchEnv();
    process.env.OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("parses verified no-key provider response shapes", () => {
    expect(
      parseStartpageResults(`
        <div class="result">
          <a class="result-title" href="https://github.com/">
            <h2>GitHub</h2>
          </a>
          <p class="description">Build software faster.</p>
        </div>
      `)
    ).toEqual([
      {
        snippet: "Build software faster.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);

    const webcrawlerResults = parseWebcrawlerResults(`
        <div class="web-google__result">
          <a class="web-google__title" href="https://github.com/">GitHub</a>
          <span class="web-google__description">
            Software collaboration platform.
          </span>
        </div>
      `);
    expect(webcrawlerResults[0]).toEqual({
      snippet: "Software collaboration platform.",
      title: "GitHub",
      url: "https://github.com/",
    });
  });

  it("keeps low-quality niche sources out of standalone routing", () => {
    const providerNames = createZeroKeyProviders().map(
      (provider) => provider.name
    );

    expect(providerNames).toEqual(["Startpage", "Webcrawler"]);
  });

  it("routes no-key Startpage before scrape fallback", async () => {
    process.env.OPENSEARCH_STARTPAGE_URL = "http://localhost/startpage";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse(`
        <div class="result">
          <a class="result-title" href="https://github.com/">GitHub</a>
          <p class="description">Startpage no-key result.</p>
        </div>
      `)
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github", 1);

    expect(results).toEqual([
      {
        engine: "Startpage",
        snippet: "Startpage no-key result.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost/startpage?cat=web&query=github",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("falls through no-result zero-key providers to the next working one", async () => {
    process.env.OPENSEARCH_STARTPAGE_URL = "http://localhost/startpage";
    process.env.OPENSEARCH_WEBCRAWLER_URL = "http://localhost/webcrawler";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse("<html>No usable links</html>"))
      .mockResolvedValueOnce(
        createMockResponse(`
          <div class="web-google__result">
            <a class="web-google__title" href="https://github.com/">
              GitHub
            </a>
            <p>Webcrawler recovered.</p>
          </div>
        `)
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github", 1);

    expect(results[0]).toEqual({
      engine: "Webcrawler",
      snippet: "Webcrawler recovered.",
      title: "GitHub",
      url: "https://github.com/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

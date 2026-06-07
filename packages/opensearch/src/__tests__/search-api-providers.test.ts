import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockJsonResponse,
  createMockResponse,
  readFixture,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("credential-backed search providers", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("returns Brave results when Brave is configured and succeeds", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        web: {
          results: [
            {
              description:
                "GitHub is where over 100 million developers shape the future of software.",
              title: "GitHub · Build and ship software",
              url: "https://github.com/",
            },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Brave",
        snippet:
          "GitHub is where over 100 million developers shape the future of software.",
        title: "GitHub · Build and ship software",
        url: "https://github.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://api.search.brave.com/res/v1/web/search?count=10&q=github&search_lang=en"
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-key",
        }),
        method: "GET",
      })
    );
  });

  it("falls back to Exa when Brave fails", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["GitHub is where people build software."],
              title: "GitHub",
              url: "https://github.com/",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "GitHub is where people build software.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("continues to later providers when Brave auth is misconfigured", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "bad-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa fallback after Brave auth failure."],
              title: "Exa fallback",
              url: "https://example.com/exa-auth-fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Exa fallback after Brave auth failure.",
        title: "Exa fallback",
        url: "https://example.com/exa-auth-fallback",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("continues to scrape providers when Exa auth is misconfigured", async () => {
    process.env.EXA_API_KEY = "bad-exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.exa.ai/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "bad-exa-key",
        }),
        method: "POST",
      })
    );
  });

  it("falls back when Brave returns 403", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

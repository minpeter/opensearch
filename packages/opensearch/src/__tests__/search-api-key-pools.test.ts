import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("credential-backed search API key pools", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("retries the next Brave API key on HTTP 429 before falling back", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-a;brave-b";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          web: {
            results: [
              {
                description: "Brave recovered with the second key.",
                title: "Brave pooled key",
                url: "https://example.com/brave-pooled",
              },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("brave pooled", 1);

    expect(results[0]).toEqual({
      engine: "Brave",
      snippet: "Brave recovered with the second key.",
      title: "Brave pooled key",
      url: "https://example.com/brave-pooled",
    });
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "X-Subscription-Token": "brave-a" }),
      expect.objectContaining({ "X-Subscription-Token": "brave-b" }),
    ]);
  });

  it("retries the next Exa search API key on HTTP 429 before falling back", async () => {
    process.env.EXA_API_KEY = "exa-a;exa-b";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa recovered with the second key."],
              title: "Exa pooled key",
              url: "https://example.com/exa-pooled",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("exa pooled", 1);

    expect(results[0]).toEqual({
      engine: "Exa",
      snippet: "Exa recovered with the second key.",
      title: "Exa pooled key",
      url: "https://example.com/exa-pooled",
    });
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "x-api-key": "exa-a" }),
      expect.objectContaining({ "x-api-key": "exa-b" }),
    ]);
  });

  it("does not try the next Tavily key for malformed provider payloads", async () => {
    process.env.TAVILY_API_KEY = "tavily-a;tavily-b";
    process.env.SERPER_API_KEY = "serper-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ unexpected: true }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          organic: [
            {
              link: "https://example.com/serper-after-malformed",
              snippet: "Serper recovered after malformed Tavily payload.",
              title: "Serper fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("malformed pool", 1);

    expect(results[0]).toEqual({
      engine: "Serper",
      snippet: "Serper recovered after malformed Tavily payload.",
      title: "Serper fallback",
      url: "https://example.com/serper-after-malformed",
    });
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ Authorization: "Bearer tavily-a" }),
      expect.objectContaining({ "X-API-KEY": "serper-key" }),
    ]);
  });

  it("rotates the starting key across repeated top-level search calls", async () => {
    process.env.TAVILY_API_KEY = "tavily-a;tavily-b";
    const mockFetch = vi.fn().mockImplementation(() =>
      createMockJsonResponse({
        results: [
          {
            content: "Tavily repeated search result.",
            title: "Tavily repeated key pool",
            url: "https://example.com/tavily-repeated",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await search("repeat pool one", 1);
    await search("repeat pool two", 1);

    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ Authorization: "Bearer tavily-a" }),
      expect.objectContaining({ Authorization: "Bearer tavily-b" }),
    ]);
  });

  it("keeps Google CSE engine id single while pooling API keys", async () => {
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = "google-a;google-b";
    process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID = "engine-1";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          items: [
            {
              link: "https://example.com/google-pooled",
              snippet: "Google CSE recovered with second key.",
              title: "Google pooled key",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("google pooled", 1);

    expect(results[0]?.engine).toBe("Google");
    const urls = mockFetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.searchParams.get("key"))).toEqual([
      "google-a",
      "google-b",
    ]);
    expect(urls.map((url) => url.searchParams.get("cx"))).toEqual([
      "engine-1",
      "engine-1",
    ]);
  });
});

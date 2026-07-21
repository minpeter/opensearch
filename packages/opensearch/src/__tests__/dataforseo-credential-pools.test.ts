import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processEnvironmentReader } from "../environment.ts";
import { createBasicAuthHeader } from "../providers/shared/base-url.ts";
import { createSearchService } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

// These tests pin single-pass provider behavior, so they use the uncached
// single-attempt path rather than the retrying, caching module-level search().
const { search } = createSearchService(processEnvironmentReader);

const SECRET_VALUE_PATTERN = /login-secret|password-secret/u;

describe("DataForSEO credential pair pools", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetSearchEnv();
  });

  it("rejects mismatched credential pools without leaking secrets", async () => {
    process.env.DATAFORSEO_LOGIN = "login-secret-a;login-secret-b";
    process.env.DATAFORSEO_PASSWORD = "password-secret-a";
    vi.stubGlobal("fetch", vi.fn());

    await expect(search("dataforseo mismatch", 1)).rejects.toThrow(
      "DATAFORSEO_LOGIN has 2 entries but DATAFORSEO_PASSWORD has 1 entries"
    );
    await expect(search("dataforseo mismatch", 1)).rejects.not.toThrow(
      SECRET_VALUE_PATTERN
    );
  });

  it("retries the next credential pair on HTTP 429", async () => {
    process.env.DATAFORSEO_LOGIN = "data-login-a;data-login-b";
    process.env.DATAFORSEO_PASSWORD = "data-password-a;data-password-b";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          tasks: [
            {
              result: [
                {
                  items: [
                    {
                      description: "DataForSEO recovered with second pair.",
                      title: "DataForSEO pooled pair",
                      url: "https://example.com/dataforseo-pooled",
                    },
                  ],
                },
              ],
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("dataforseo pooled", 1);

    expect(results[0]).toEqual({
      engine: "DataForSEO",
      snippet: "DataForSEO recovered with second pair.",
      title: "DataForSEO pooled pair",
      url: "https://example.com/dataforseo-pooled",
    });
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({
        Authorization: basicAuth("data-login-a", "data-password-a"),
      }),
      expect.objectContaining({
        Authorization: basicAuth("data-login-b", "data-password-b"),
      }),
    ]);
  });

  it("encodes non-ASCII credential pairs as UTF-8 Basic auth", async () => {
    process.env.DATAFORSEO_LOGIN = "데이터-login";
    process.env.DATAFORSEO_PASSWORD = "pässword";
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        tasks: [
          {
            result: [
              {
                items: [
                  {
                    description: "DataForSEO unicode credential result.",
                    title: "DataForSEO unicode",
                    url: "https://example.com/dataforseo-unicode",
                  },
                ],
              },
            ],
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("dataforseo unicode", 1);

    expect(results[0]?.engine).toBe("DataForSEO");
    expect(mockFetch.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: basicAuth("데이터-login", "pässword"),
      })
    );
  });

  it("creates Basic auth without the Node Buffer global", () => {
    vi.stubGlobal("Buffer", undefined);

    const header = createBasicAuthHeader("데이터-login", "pässword");

    expect(header).toBe("Basic 642w7J207YSwLWxvZ2luOnDDpHNzd29yZA==");
  });

  it("does not try the next pair for malformed payloads", async () => {
    process.env.DATAFORSEO_LOGIN = "malformed-login-a;malformed-login-b";
    process.env.DATAFORSEO_PASSWORD =
      "malformed-password-a;malformed-password-b";
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = "google-after-dataforseo";
    process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID = "engine-after-dataforseo";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ unexpected: true }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          items: [
            {
              link: "https://example.com/google-after-dataforseo",
              snippet: "Google recovered after malformed DataForSEO.",
              title: "Google fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("dataforseo malformed", 1);

    expect(results[0]?.engine).toBe("Google");
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({
        Authorization: basicAuth("malformed-login-a", "malformed-password-a"),
      }),
      expect.objectContaining({}),
    ]);
    expect(
      JSON.stringify(mockFetch.mock.calls.map(([, init]) => init?.headers))
    ).not.toContain(basicAuth("malformed-login-b", "malformed-password-b"));
  });

  it("rotates starting pairs across repeated search calls", async () => {
    process.env.DATAFORSEO_LOGIN = "repeat-login-a;repeat-login-b";
    process.env.DATAFORSEO_PASSWORD = "repeat-password-a;repeat-password-b";
    const mockFetch = vi.fn().mockImplementation(() =>
      createMockJsonResponse({
        tasks: [
          {
            result: [
              {
                items: [
                  {
                    description: "DataForSEO repeated search result.",
                    title: "DataForSEO repeated pair",
                    url: "https://example.com/dataforseo-repeated",
                  },
                ],
              },
            ],
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await search("dataforseo repeat one", 1);
    await search("dataforseo repeat two", 1);

    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({
        Authorization: basicAuth("repeat-login-a", "repeat-password-a"),
      }),
      expect.objectContaining({
        Authorization: basicAuth("repeat-login-b", "repeat-password-b"),
      }),
    ]);
  });
});

function basicAuth(login: string, password: string): string {
  return `Basic ${encodeUtf8Base64(`${login}:${password}`)}`;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentReader } from "../environment.ts";
import { requestFirecrawlJson } from "../providers/firecrawl/request.ts";

function envWith(values: Record<string, string>): EnvironmentReader {
  return { read: (key: string) => values[key] };
}

function okJsonResponse(payload: unknown = { data: {} }) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("requestFirecrawlJson endpoint resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves proxy prefixes and query parameters in the base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await requestFirecrawlJson({
      body: {},
      endpoint: "search",
      env: envWith({
        OPENSEARCH_FIRECRAWL_URL: "https://proxy.example/fc?token=secret",
      }),
      useApiKey: false,
    });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe("https://proxy.example/fc/search?token=secret");
  });

  it("appends the endpoint to a plain base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await requestFirecrawlJson({
      body: {},
      endpoint: "scrape",
      env: envWith({ OPENSEARCH_FIRECRAWL_URL: "https://proxy.example/fc" }),
      useApiKey: false,
    });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe("https://proxy.example/fc/scrape");
  });

  it("replaces a trailing endpoint segment in the base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await requestFirecrawlJson({
      body: {},
      endpoint: "search",
      env: envWith({
        OPENSEARCH_FIRECRAWL_URL: "https://proxy.example/fc/scrape",
      }),
      useApiKey: false,
    });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe("https://proxy.example/fc/search");
  });
});

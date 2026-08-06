import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenSearch } from "../node.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

const DISABLE_HOSTED_ENV = {
  OPENSEARCH_ENABLE_EXA_MCP: "false",
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
  OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
} as const;

const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>Config Article</title></head>
  <body><article><h1>Config Article</h1>
  <p>Readable content for explicit client fetch.</p>
  <p>Second paragraph to satisfy extraction.</p>
  <p>Final paragraph for stable output.</p></article></body></html>`;

describe("createOpenSearch", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("applies a bounded per-client fetch cache policy", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(ARTICLE_HTML, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);
    const client = createOpenSearch({
      env: DISABLE_HOSTED_ENV,
      fetch: { cache: { maxEntries: 1 } },
    });

    await client.fetch("https://example.com/one");
    await client.fetch("https://example.com/two");
    await client.fetch("https://example.com/one");

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid cache policies at client creation", () => {
    expect(() =>
      createOpenSearch({ search: { cache: { maxEntries: 0 } } })
    ).toThrow("cache.maxEntries must be a positive safe integer");
    expect(() => createOpenSearch({ fetch: { cache: { ttlMs: 0 } } })).toThrow(
      "cache.ttlMs must be a positive safe integer"
    );
  });

  it("uses explicit Exa fetch config without inheriting process env", async () => {
    process.env.EXA_API_KEY = "process-exa-key";
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        createMockJsonResponse({
          results: [
            {
              text: "# Explicit Exa body",
              title: "Explicit Exa",
              url: "https://example.com/exa-fetch",
            },
          ],
          statuses: [
            {
              id: "https://example.com/exa-fetch",
              status: "success",
            },
          ],
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        EXA_API_KEY: "client-exa-key",
      },
    });

    const result = await client.fetch("https://example.com/exa-fetch");

    expect(result.title).toBe("Explicit Exa");
    expect(readRequestHeader(mockFetch.mock.calls[0]?.[1], "x-api-key")).toBe(
      "client-exa-key"
    );
  });

  it("uses explicit TinyFish fetch config without inheriting process env", async () => {
    process.env.TINYFISH_API_KEY = "process-tinyfish-key";
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        createMockJsonResponse({
          results: [
            {
              text: "# Explicit TinyFish body",
              title: "Explicit TinyFish",
              url: "https://example.com/tinyfish-fetch",
            },
          ],
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const client = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        TINYFISH_API_KEY: "client-tinyfish-key",
      },
    });

    const result = await client.fetch("https://example.com/tinyfish-fetch");

    expect(result.title).toBe("Explicit TinyFish");
    expect(readRequestHeader(mockFetch.mock.calls[0]?.[1], "X-API-Key")).toBe(
      "client-tinyfish-key"
    );
  });
});

function readRequestHeader(
  init: unknown,
  headerName: string
): string | undefined {
  const headers = (init as RequestInit | undefined)?.headers;

  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  if (headers && typeof headers === "object" && headerName in headers) {
    return String((headers as Record<string, unknown>)[headerName]);
  }
}

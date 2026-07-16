import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("unpdf", () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

const { fetchExaMcp, fetchExaMcpBatch } = vi.hoisted(() => ({
  fetchExaMcp: vi.fn(),
  fetchExaMcpBatch: vi.fn(),
}));

vi.mock("../providers/exa-mcp/client.ts", () => ({
  fetchExaMcp,
  fetchExaMcpBatch,
}));

import { ARTICLE_HTML, createMockResponse } from "./fetch-test-helpers.ts";
import { fetchUrls } from "./full-runtime.ts";

describe("Firecrawl batch fetch fallback", () => {
  beforeEach(() => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.OPENSEARCH_ENABLE_FIRECRAWL = "true";
    delete process.env.EXA_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.OPENSEARCH_FIRECRAWL_URL;
    delete process.env.TINYFISH_API_KEY;
    fetchExaMcp.mockReset();
    fetchExaMcpBatch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENSEARCH_ENABLE_EXA_MCP;
    delete process.env.OPENSEARCH_ENABLE_FIRECRAWL;
  });

  it("preserves successful Firecrawl scrapes when one batch URL falls back locally", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              markdown: "# Firecrawl one",
              metadata: null,
            },
            success: true,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "upstream unavailable" }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        })
      )
      .mockImplementation(() =>
        Promise.resolve(createMockResponse(ARTICLE_HTML))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    expect(results[0]).toEqual({
      content: "# Firecrawl one",
      length: "# Firecrawl one".length,
      title: "",
      url: "https://example.com/one",
    });
    expect(results[1]?.content).toContain("Test Heading");
    expect(results[1]?.url).toBe("https://example.com/two");
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://api.firecrawl.dev/v2/scrape")
      )
    ).toHaveLength(2);
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://example.com/")
      )
    ).toHaveLength(1);
    expect(
      mockFetch.mock.calls.some(([url]) =>
        String(url).startsWith("https://example.com/one")
      )
    ).toBe(false);
  });

  it("does not invoke local fallback after an HTTP 451 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("legal restriction", { status: 451 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchUrls(["https://example.com/restricted"])
    ).rejects.toMatchObject({ status: 451 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.firecrawl.dev/v2/scrape"
    );
  });
});

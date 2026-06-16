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

import { stubHtmlFetch } from "./fetch-test-helpers.ts";
import { fetchUrl } from "./full-runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
  process.env.OPENSEARCH_ENABLE_FIRECRAWL = "false";
  delete process.env.EXA_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  fetchExaMcp.mockReset();
  fetchExaMcp.mockRejectedValue(new Error("Exa MCP unavailable"));
  fetchExaMcpBatch.mockReset();
  fetchExaMcpBatch.mockRejectedValue(new Error("Exa MCP unavailable"));
});

describe("fetchUrl routing", () => {
  it("returns Exa MCP content first when available and preserves the requested URL", async () => {
    fetchExaMcp.mockResolvedValueOnce({
      content: "# Exa markdown body",
      title: "Exa title",
      url: "https://exa.ai/article",
    });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(result).toEqual({
      content: "# Exa markdown body",
      length: "# Exa markdown body".length,
      title: "Exa title",
      url: "https://example.com/article",
    });
    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to the local fetch pipeline when Exa MCP fails", async () => {
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
  });

  it("falls back to the official Exa contents API when Exa MCP fails and EXA_API_KEY is set", async () => {
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# Exa API body",
              title: "Exa API title",
              url: "https://example.com/article",
            },
          ],
          statuses: [
            {
              id: "https://example.com/article",
              status: "success",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.exa.ai/contents",
      expect.objectContaining({
        body: JSON.stringify({
          text: {
            maxCharacters: 12_000,
          },
          urls: ["https://example.com/article"],
        }),
        headers: expect.objectContaining({ "x-api-key": "exa-key" }),
        method: "POST",
      })
    );
    expect(result).toEqual({
      content: "# Exa API body",
      length: "# Exa API body".length,
      title: "Exa API title",
      url: "https://example.com/article",
    });
  });

  it("uses TinyFish before the official Exa contents API when configured", async () => {
    process.env.TINYFISH_API_KEY = " tinyfish-fetch-key ";
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa MCP unavailable"));
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [],
          results: [
            {
              final_url: "https://example.com/article",
              format: "markdown",
              text: "# TinyFish body",
              title: "TinyFish title",
              url: "https://example.com/article",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(result).toEqual({
      content: "# TinyFish body",
      length: "# TinyFish body".length,
      title: "TinyFish title",
      url: "https://example.com/article",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.fetch.tinyfish.ai",
      expect.objectContaining({
        body: JSON.stringify({
          format: "markdown",
          image_links: false,
          links: false,
          urls: ["https://example.com/article"],
        }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-Key": "tinyfish-fetch-key",
        }),
        method: "POST",
      })
    );
  });
});

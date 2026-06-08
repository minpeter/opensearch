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

import { fetchUrls } from "../fetch.ts";
import { ARTICLE_HTML, createMockResponse } from "./fetch-test-helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
  delete process.env.EXA_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  fetchExaMcp.mockReset();
  fetchExaMcp.mockRejectedValue(new Error("Exa MCP unavailable"));
  fetchExaMcpBatch.mockReset();
  fetchExaMcpBatch.mockRejectedValue(new Error("Exa MCP unavailable"));
});

describe("fetchUrls routing", () => {
  it("passes batched urls through hosted Exa MCP before per-url fallbacks", async () => {
    fetchExaMcpBatch.mockResolvedValueOnce([
      {
        content: "# First body",
        title: "First title",
        url: "https://example.com/one",
      },
      {
        content: "# Second body",
        title: "Second title",
        url: "https://example.com/two",
      },
    ]);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    expect(fetchExaMcpBatch).toHaveBeenCalledWith(
      ["https://example.com/one", "https://example.com/two"],
      12_000
    );
    expect(results).toEqual([
      {
        content: "# First body",
        length: "# First body".length,
        title: "First title",
        url: "https://example.com/one",
      },
      {
        content: "# Second body",
        length: "# Second body".length,
        title: "Second title",
        url: "https://example.com/two",
      },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not retry TinyFish per URL after a TinyFish batch fallback", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.TINYFISH_API_KEY = "tinyfish-fetch-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [],
            results: [
              {
                final_url: "https://example.com/one",
                format: "markdown",
                title: "Missing text should fail strict parsing",
                url: "https://example.com/one",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(createMockResponse(ARTICLE_HTML))
      .mockResolvedValueOnce(createMockResponse(ARTICLE_HTML));
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    expect(results).toHaveLength(2);
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://api.fetch.tinyfish.ai")
      )
    ).toHaveLength(1);
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://example.com/")
      )
    ).toHaveLength(2);
  });

  it("falls back instead of mapping a partial TinyFish batch result to the wrong URL", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.TINYFISH_API_KEY = "tinyfish-fetch-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [
              {
                error: "upstream failure",
                url: "https://example.com/one",
              },
            ],
            results: [
              {
                text: "# TinyFish result for the second URL only",
                url: "https://example.com/two",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(createMockResponse(ARTICLE_HTML))
      .mockResolvedValueOnce(createMockResponse(ARTICLE_HTML));
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.content).not.toContain(
      "TinyFish result for the second URL only"
    );
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://api.fetch.tinyfish.ai")
      )
    ).toHaveLength(1);
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://example.com/")
      )
    ).toHaveLength(2);
  });

  it("passes maxCharacters through to the official Exa contents API for batched fetches", async () => {
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcpBatch.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# First Exa API body",
              title: "First Exa API title",
              url: "https://example.com/one",
            },
            {
              text: "# Second Exa API body",
              title: "Second Exa API title",
              url: "https://example.com/two",
            },
          ],
          statuses: [
            {
              id: "https://example.com/one",
              status: "success",
            },
            {
              id: "https://example.com/two",
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

    const results = await fetchUrls(
      ["https://example.com/one", "https://example.com/two"],
      4000
    );

    expect(fetchExaMcpBatch).toHaveBeenCalledWith(
      ["https://example.com/one", "https://example.com/two"],
      4000
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.exa.ai/contents",
      expect.objectContaining({
        body: JSON.stringify({
          text: {
            maxCharacters: 4000,
          },
          urls: ["https://example.com/one", "https://example.com/two"],
        }),
        headers: expect.objectContaining({ "x-api-key": "exa-key" }),
        method: "POST",
      })
    );
    expect(results).toEqual([
      {
        content: "# First Exa API body",
        length: "# First Exa API body".length,
        title: "First Exa API title",
        url: "https://example.com/one",
      },
      {
        content: "# Second Exa API body",
        length: "# Second Exa API body".length,
        title: "Second Exa API title",
        url: "https://example.com/two",
      },
    ]);
  });
});

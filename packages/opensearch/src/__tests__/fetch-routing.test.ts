import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("unpdf", () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

const { fetchExaMcp, fetchExaMcpBatch } = vi.hoisted(() => ({
  fetchExaMcp: vi.fn(),
  fetchExaMcpBatch: vi.fn(),
}));

vi.mock("../exa-mcp.ts", () => ({
  fetchExaMcp,
  fetchExaMcpBatch,
}));

import { fetchUrl, fetchUrls } from "../fetch.ts";
import {
  ARTICLE_HTML,
  createMockResponse,
  stubHtmlFetch,
} from "./fetch-test-helpers.ts";

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

  it("retries TinyFish fetch only on 429 with the next configured key", async () => {
    process.env.TINYFISH_API_KEY = "tf-fetch-1; ;tf-fetch-2";
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa MCP unavailable"));
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [],
            results: [
              {
                final_url: "https://example.com/article",
                format: "markdown",
                text: "# TinyFish body",
                url: "https://example.com/article",
              },
            ],
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).toBe("# TinyFish body");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "X-API-Key": "tf-fetch-1" }),
      expect.objectContaining({ "X-API-Key": "tf-fetch-2" }),
    ]);
  });

  it("falls back when TinyFish fetch returns malformed fields", async () => {
    process.env.TINYFISH_API_KEY = "tinyfish-fetch-key";
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa MCP unavailable"));
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [],
            results: [
              {
                final_url: "https://example.com/article",
                format: "markdown",
                title: "Missing text should fail strict parsing",
                url: "https://example.com/article",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
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

    expect(result).toEqual({
      content: "# Exa API body",
      length: "# Exa API body".length,
      title: "Exa API title",
      url: "https://example.com/article",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses the official Exa contents API when hosted Exa MCP is disabled but EXA_API_KEY is set", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.EXA_API_KEY = "exa-key";
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# Exa API only body",
              title: "Exa API only title",
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

    expect(fetchExaMcp).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.title).toBe("Exa API only title");
    expect(result.content).toBe("# Exa API only body");
  });

  it("skips Exa MCP entirely when OPENSEARCH_ENABLE_EXA_MCP is false", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    const mockFetch = stubHtmlFetch();

    await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
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

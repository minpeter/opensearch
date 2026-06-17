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
import { fetchUrl, fetchUrls } from "./full-runtime.ts";

function getRequestBody(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const init = mockFetch.mock.calls[0]?.[1];
  const body = init?.body;

  return typeof body === "string" ? JSON.parse(body) : undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENSEARCH_ENABLE_FIRECRAWL;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.OPENSEARCH_FIRECRAWL_URL;
});

beforeEach(() => {
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
  process.env.OPENSEARCH_ENABLE_FIRECRAWL = "false";
  delete process.env.EXA_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.OPENSEARCH_FIRECRAWL_URL;
  delete process.env.TINYFISH_API_KEY;
  fetchExaMcp.mockReset();
  fetchExaMcp.mockRejectedValue(new Error("Exa MCP unavailable"));
  fetchExaMcpBatch.mockReset();
  fetchExaMcpBatch.mockRejectedValue(new Error("Exa MCP unavailable"));
});

describe("fetchUrl fallback routing", () => {
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

  it("routes zero-config page fetch through Firecrawl before local HTML parsing", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.OPENSEARCH_ENABLE_FIRECRAWL = "true";
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            markdown: "# Firecrawl body",
            metadata: null,
          },
          success: true,
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
      content: "# Firecrawl body",
      length: "# Firecrawl body".length,
      title: "",
      url: "https://example.com/article",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/scrape",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
        method: "POST",
      })
    );
    expect(getRequestBody(mockFetch)).toEqual({
      blockAds: true,
      formats: ["markdown"],
      onlyCleanContent: true,
      onlyMainContent: true,
      parsers: ["pdf"],
      proxy: "auto",
      removeBase64Images: true,
      timeout: 30_000,
      url: "https://example.com/article",
    });
  });

  it("routes a batch URL through Phase-0 public API before the providers", async () => {
    const redditBody = JSON.stringify([
      { data: { children: [{ data: { selftext: "Body", title: "Post" } }] } },
      { data: { children: [] } },
    ]);
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(redditBody, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const [result] = await fetchUrls([
      "https://www.reddit.com/r/x/comments/abc/title/",
    ]);

    expect(result?.title).toBe("Post");
    expect(fetchExaMcpBatch).not.toHaveBeenCalled();
  });
});

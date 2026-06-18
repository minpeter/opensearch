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

function redditListingResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        children: [
          {
            data: {
              author: "ferris",
              num_comments: 7,
              score: 42,
              title: "Rust 1.99 Released",
              url: "https://blog.rust-lang.org/release",
            },
          },
        ],
      },
    }),
    { status: 200 }
  );
}

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

describe("fetch orchestration telemetry", () => {
  it("reassembles public API and local fallback results in the requested order", async () => {
    const redditUrl = "https://www.reddit.com/r/rust/hot/";
    const localUrl = "https://example.com/article";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(redditListingResponse())
      .mockImplementation(() =>
        Promise.resolve(createMockResponse(ARTICLE_HTML))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([localUrl, redditUrl]);

    expect(results.map((result) => result.url)).toEqual([localUrl, redditUrl]);
    expect(results[1]).toMatchObject({
      title: "r/rust hot",
      url: redditUrl,
    });
  });
});

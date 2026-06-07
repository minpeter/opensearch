import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUrl } from "../fetch.ts";
import { createOpenSearch } from "../index.ts";

describe("Exa contents fetch API key pools", () => {
  beforeEach(() => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    delete process.env.EXA_API_KEY;
    delete process.env.TINYFISH_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENSEARCH_ENABLE_EXA_MCP;
    delete process.env.EXA_API_KEY;
    delete process.env.TINYFISH_API_KEY;
  });

  it("retries the next Exa contents API key on HTTP 429 before local fallback", async () => {
    process.env.EXA_API_KEY = "exa-a;exa-b";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createExaContentsResponse("https://example.com/a")
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/a");

    expect(result).toEqual({
      content: "# Exa content for https://example.com/a",
      length: "# Exa content for https://example.com/a".length,
      title: "Exa content",
      url: "https://example.com/a",
    });
    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "x-api-key": "exa-a" }),
      expect.objectContaining({ "x-api-key": "exa-b" }),
    ]);
  });

  it("rotates Exa contents API keys across repeated explicit client fetches", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createExaContentsResponse("https://example.com/one")
      )
      .mockResolvedValueOnce(
        createExaContentsResponse("https://example.com/two")
      );
    vi.stubGlobal("fetch", mockFetch);
    const openSearch = createOpenSearch({
      env: {
        EXA_API_KEY: "fetch-a;fetch-b",
        OPENSEARCH_ENABLE_EXA_MCP: "false",
      },
    });

    await openSearch.fetch("https://example.com/one");
    await openSearch.fetch("https://example.com/two");

    expect(mockFetch.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ "x-api-key": "fetch-a" }),
      expect.objectContaining({ "x-api-key": "fetch-b" }),
    ]);
  });
});

function createExaContentsResponse(url: string): Response {
  return new Response(
    JSON.stringify({
      results: [
        {
          text: `# Exa content for ${url}`,
          title: "Exa content",
          url,
        },
      ],
      statuses: [
        {
          id: url,
          status: "success",
        },
      ],
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }
  );
}

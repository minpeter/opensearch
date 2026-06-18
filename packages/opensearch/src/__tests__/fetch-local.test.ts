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

import {
  createMockResponse,
  DIV_TAG_REGEX,
  H1_TAG_REGEX,
  IMG_TAG_REGEX,
  JINA_URL_REGEX,
  MD_IMAGE_REGEX,
  P_TAG_REGEX,
  stubHtmlFetch,
} from "./fetch-test-helpers.ts";
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

describe("fetchUrl local HTML extraction", () => {
  it("returns title and markdown content from HTML page", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.url).toBe("https://example.com/article");
    expect(typeof result.length).toBe("number");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns clean fetch result shape", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result).toEqual({
      content: expect.any(String),
      length: expect.any(Number),
      title: "Test Article",
      url: "https://example.com/article",
    });
  });

  it("content is markdown with no raw HTML tags", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).not.toMatch(H1_TAG_REGEX);
    expect(result.content).not.toMatch(P_TAG_REGEX);
    expect(result.content).not.toMatch(DIV_TAG_REGEX);
  });

  it("strips img tags from output", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).not.toMatch(MD_IMAGE_REGEX);
    expect(result.content).not.toMatch(IMG_TAG_REGEX);
  });

  it("returns short content for minimal HTML when Jina also fails", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse(minimalHtml))
      .mockRejectedValueOnce(new Error("Jina unavailable"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/minimal");

    expect(result.url).toBe("https://example.com/minimal");
    expect(typeof result.content).toBe("string");
  });
});

describe("fetchUrl challenge / block escalation", () => {
  it("retries a URL variant then the Jina reader on a 200 challenge", async () => {
    const challengeHtml =
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>";
    const jina =
      "Real readable content recovered by the Jina reader, long enough to be kept.";
    const mockFetch = vi
      .fn()
      // 1) origin -> challenge, 2) m.* variant -> still blocked, 3) Jina -> ok
      .mockResolvedValueOnce(
        new Response(challengeHtml, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response(jina, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/cf");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("m.example.com");
    expect(String(mockFetch.mock.calls[2]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toBe(jina);
  });

  it("escalates a 403 block status to a variant then the Jina reader", async () => {
    const jina =
      "Reader content recovered after a 403 from the origin, kept because it is long enough.";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response(jina, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/forbidden");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("m.example.com");
    expect(String(mockFetch.mock.calls[2]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toBe(jina);
  });

  it("throws when a challenge page cannot be recovered at all", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>cf-chl-bypass</html>", {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockRejectedValueOnce(new Error("Jina down"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchUrl("https://example.com/cf-hard")).rejects.toThrow(
      "anti-bot challenge"
    );
  });

  it("rejects a too-short reader body on the blocked path", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("x", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchUrl("https://example.com/forbidden2")).rejects.toThrow(
      "anti-bot challenge"
    );
  });
});

describe("fetchUrl metadata fallback", () => {
  it("falls back to OGP metadata when content is sparse and the reader fails", async () => {
    const ogpHtml =
      '<html><head><meta property="og:title" content="SPA Title"><meta property="og:description" content="A sufficiently long open-graph description that clears the fifty character threshold."></head><body><div id="root"></div></body></html>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(ogpHtml, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockRejectedValueOnce(new Error("Jina down"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/spa");

    expect(result.title).toBe("SPA Title");
    expect(result.content).toContain("open-graph description");
  });
});

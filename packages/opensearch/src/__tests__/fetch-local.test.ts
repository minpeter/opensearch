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

import { extractText, getDocumentProxy } from "unpdf";

import { fetchUrl } from "../fetch.ts";
import {
  createMockPdfDocument,
  createMockResponse,
  DIV_TAG_REGEX,
  H1_TAG_REGEX,
  IMG_TAG_REGEX,
  JINA_URL_REGEX,
  MD_IMAGE_REGEX,
  P_TAG_REGEX,
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

describe("fetchUrl PDF extraction", () => {
  it("detects PDF by URL extension and returns text content", async () => {
    const fakeText = "This is extracted PDF text content for testing purposes.";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ArrayBuffer(100), {
          headers: { "Content-Type": "application/pdf" },
          status: 200,
        })
      )
    );

    vi.mocked(getDocumentProxy).mockResolvedValue(createMockPdfDocument());
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl("https://example.com/document.pdf");

    expect(result.content).toBe(fakeText);
    expect(result.url).toBe("https://example.com/document.pdf");
  });

  it("detects PDF by Content-Type for non-.pdf URL", async () => {
    const fakeText = "PDF content detected by content-type header.";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ArrayBuffer(100), {
          headers: { "Content-Type": "application/pdf" },
          status: 200,
        })
      )
    );

    vi.mocked(getDocumentProxy).mockResolvedValue(createMockPdfDocument());
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl("https://example.com/download/file");

    expect(result.content).toBe(fakeText);
  });
});

describe("fetchUrl Jina fallback", () => {
  it("uses Jina fallback when content is less than 50 chars", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";
    const jinaContent =
      "This is the Jina AI extracted content that is much longer and more useful than the original short content.";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(jinaContent, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toBe(jinaContent);
    expect(result.length).toBe(jinaContent.length);
  });

  it("gracefully handles Jina fallback failure", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockRejectedValueOnce(new Error("Jina timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse-fail");

    expect(result.url).toBe("https://example.com/sparse-fail");
    expect(typeof result.content).toBe("string");
  });

  it("keeps extracted content when Jina returns a non-ok response", async () => {
    const minimalHtml =
      "<html><body><article><p>Hi</p></article></body></html>";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("fallback error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse-non-ok");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toContain("Hi");
    expect(result.content).not.toContain("fallback error");
  });
});

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

import { extractText, getDocumentProxy } from "unpdf";
import { createMockPdfDocument, JINA_URL_REGEX } from "./fetch-test-helpers.ts";
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

  it("PDF-extracts a variant served after the origin is blocked", async () => {
    const pdfText = "VARIANT PDF TEXT extracted from the mobile host.";
    vi.mocked(getDocumentProxy).mockResolvedValue(createMockPdfDocument());
    vi.mocked(extractText).mockResolvedValue({ text: pdfText, totalPages: 1 });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(new ArrayBuffer(100), {
          headers: { "Content-Type": "application/pdf" },
          status: 200,
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/doc.pdf");

    expect(result.content).toBe(pdfText);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("m.example.com");
    expect(extractText).toHaveBeenCalled();
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

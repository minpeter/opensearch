import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi knowledge provider routes", () => {
  it("routes arXiv search pages through the export API", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "<feed><entry><title> Transformer Paper </title><id>https://arxiv.org/abs/1</id><summary> A result </summary></entry></feed>",
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://arxiv.org/search/?query=transformer"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://export.arxiv.org/api/query?search_query=all%3Atransformer&max_results=5&sortBy=submittedDate&sortOrder=descending"
    );
    expect(result?.content).toContain("Transformer Paper");
  });

  it("routes DOI URLs through CrossRef works", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        message: {
          author: [{ family: "Lovelace", given: "Ada" }],
          "container-title": ["Journal"],
          DOI: "10.1000/example",
          issued: { "date-parts": [[2026]] },
          title: ["Example Paper"],
          URL: "https://doi.org/10.1000/example",
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://doi.org/10.1000/example");

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.crossref.org/works/10.1000%2Fexample"
    );
    expect(result?.content).toContain("Ada Lovelace");
  });

  it("routes OpenLibrary ISBN pages through the books API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        "ISBN:9780131103627": {
          authors: [{ name: "Brian Kernighan" }],
          number_of_pages: 288,
          publish_date: "1988",
          title: "The C Programming Language",
          url: "https://openlibrary.org/books/example",
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://openlibrary.org/isbn/9780131103627"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://openlibrary.org/api/books?bibkeys=ISBN%3A9780131103627&jscmd=data&format=json"
    );
    expect(result?.content).toContain("Brian Kernighan");
  });

  it("routes Wikipedia pages through REST summaries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        content_urls: {
          desktop: { page: "https://en.wikipedia.org/wiki/Search" },
        },
        description: "Information retrieval",
        extract: "Search is the act of looking for information.",
        title: "Search",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://en.wikipedia.org/wiki/Search"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://en.wikipedia.org/api/rest_v1/page/summary/Search"
    );
    expect(result?.content).toContain("Information retrieval");
  });

  it("returns null when knowledge API responses are malformed", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okJsonResponse({ message: {} }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://openlibrary.org/isbn/0")
    ).toBeNull();
  });
});

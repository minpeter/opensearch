import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi search provider routes", () => {
  it("routes GitHub repository searches through REST search", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        items: [
          {
            description: "Search runtime",
            full_name: "minpeter/opensearch",
            html_url: "https://github.com/minpeter/opensearch",
            stargazers_count: 99,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://github.com/search?q=opensearch"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/search/repositories?q=opensearch&sort=stars&per_page=5"
    );
    expect(result?.content).toContain("minpeter/opensearch");
  });

  it("routes npm package searches through registry search", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        objects: [
          {
            package: {
              description: "Package",
              links: { npm: "https://www.npmjs.com/package/pkg" },
              name: "pkg",
              version: "1.0.0",
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.npmjs.com/search?q=pkg"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://registry.npmjs.org/-/v1/search?text=pkg&size=5"
    );
    expect(result?.content).toContain("pkg@1.0.0");
  });

  it("routes OpenLibrary searches through search.json", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        docs: [
          {
            author_name: ["Author"],
            first_publish_year: 1978,
            title: "Book",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://openlibrary.org/search?q=book"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://openlibrary.org/search.json?q=book&limit=5"
    );
    expect(result?.content).toContain("Author");
  });

  it("routes CrossRef searches through works query", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        message: {
          items: [
            {
              DOI: "10.1000/example",
              title: ["Paper"],
              URL: "https://doi.org/10.1000/example",
            },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.crossref.org/search?q=paper"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.crossref.org/works?query=paper&rows=5&sort=relevance"
    );
    expect(result?.content).toContain("10.1000/example");
  });

  it("routes StackExchange searches through v2.3 search", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        items: [
          {
            answer_count: 3,
            link: "https://stackoverflow.com/questions/1",
            score: 12,
            tags: ["typescript"],
            title: "Question",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://stackoverflow.com/search?q=typescript"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.stackexchange.com/2.3/search?order=desc&sort=votes&site=stackoverflow&intitle=typescript"
    );
    expect(result?.content).toContain("3 answers");
  });

  it("routes Wikipedia searches through opensearch", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okJsonResponse([
          "Search",
          ["Search"],
          ["Looking for information"],
          ["https://en.wikipedia.org/wiki/Search"],
        ])
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://en.wikipedia.org/search?q=search"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://en.wikipedia.org/w/api.php?action=opensearch&search=search&limit=5&format=json"
    );
    expect(result?.content).toContain("Looking for information");
  });

  it("returns null when search provider APIs are empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse({ items: [] }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://github.com/search?q=none")
    ).toBeNull();
  });
});

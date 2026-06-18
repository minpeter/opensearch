import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi registry provider routes", () => {
  it("routes npm package pages through the npm registry latest endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        description: "Runtime package",
        name: "@minpeter/opensearch",
        version: "1.2.3",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.npmjs.com/package/@minpeter/opensearch"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://registry.npmjs.org/@minpeter/opensearch/latest"
    );
    expect(result?.content).toContain("Version: 1.2.3");
  });

  it("routes PyPI project pages through the PyPI JSON endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        info: {
          author: "Pythonista",
          name: "requests",
          summary: "HTTP for humans",
          version: "2.0.0",
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://pypi.org/project/requests/"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://pypi.org/pypi/requests/json"
    );
    expect(result?.content).toContain("HTTP for humans");
  });

  it("routes GitHub releases pages through the REST releases endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse([
        {
          html_url: "https://github.com/minpeter/opensearch/releases/tag/v1",
          name: "v1",
          prerelease: false,
          published_at: "2026-01-01T00:00:00Z",
          tag_name: "v1",
        },
      ])
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://github.com/minpeter/opensearch/releases"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/minpeter/opensearch/releases?per_page=5"
    );
    expect(result?.title).toBe("minpeter/opensearch releases");
  });

  it("routes Wayback URLs through the availability API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        archived_snapshots: {
          closest: {
            available: true,
            status: "200",
            timestamp: "20260101000000",
            url: "https://web.archive.org/web/20260101000000/https://example.com",
          },
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://web.archive.org/web/*/https%3A%2F%2Fexample.com"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com"
    );
    expect(result?.content).toContain("Snapshot:");
  });

  it("returns null when registry provider APIs have no usable body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okJsonResponse({ archived_snapshots: {} }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi(
        "https://web.archive.org/web/*/https://missing.example"
      )
    ).toBeNull();
  });
});

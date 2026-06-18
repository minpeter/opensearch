import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi community routes", () => {
  it("routes Mastodon profile URLs through account lookup and statuses", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        okJsonResponse({
          acct: "alice",
          display_name: "Alice",
          followers_count: 42,
          id: "123",
          note: "<p>Open &amp; federated search</p>",
          statuses_count: 9,
          username: "alice",
        })
      )
      .mockResolvedValueOnce(
        okJsonResponse([
          {
            content: "<p>Public status</p>",
            favourites_count: 4,
            reblogs_count: 2,
            url: "https://mastodon.social/@alice/1",
          },
        ])
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://mastodon.social/@alice");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://mastodon.social/api/v1/accounts/lookup?acct=alice"
    );
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(
      "https://mastodon.social/api/v1/accounts/123/statuses?limit=5"
    );
    expect(result?.title).toBe("Alice");
    expect(result?.content).toContain("Open & federated search");
    expect(result?.content).toContain("Public status");
  });

  it("returns null when Mastodon lookup is not public", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://mastodon.social/@missing")
    ).toBeNull();
  });

  it("routes Stack Overflow question URLs through StackExchange answers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        items: [
          {
            body: "<p>Use the official API &amp; validate JSON.</p>",
            is_accepted: true,
            link: "https://stackoverflow.com/a/456",
            owner: { display_name: "answerer" },
            score: 99,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://stackoverflow.com/questions/123/how-to-fetch"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://api.stackexchange.com/2.3/questions/123/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody"
    );
    expect(result?.title).toBe("stackoverflow question 123 answers");
    expect(result?.content).toContain("accepted");
    expect(result?.content).toContain("Use the official API & validate JSON.");
  });

  it("returns null when StackExchange has no usable answers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse({ items: [] }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://stackoverflow.com/questions/123/title")
    ).toBeNull();
  });
});

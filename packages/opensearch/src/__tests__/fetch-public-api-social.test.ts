import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi social routes", () => {
  it("routes an X status URL through publish oEmbed", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        author_name: "OpenSearch",
        author_url: "https://x.com/opensearch",
        html: "<blockquote>Typed &amp; readable tweet text</blockquote>",
        url: "https://x.com/opensearch/status/123",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://x.com/opensearch/status/123"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fopensearch%2Fstatus%2F123"
    );
    expect(result?.title).toBe("OpenSearch");
    expect(result?.content).toContain("Typed & readable tweet text");
  });

  it("returns null when X oEmbed returns malformed content", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse({ html: "" }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://twitter.com/opensearch/status/123")
    ).toBeNull();
  });

  it("routes a Bluesky profile through the public AT Protocol API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        description: "Open web search",
        displayName: "OpenSearch",
        followersCount: 42,
        handle: "opensearch.bsky.social",
        postsCount: 7,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://bsky.app/profile/opensearch.bsky.social"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=opensearch.bsky.social"
    );
    expect(result?.title).toBe("OpenSearch");
    expect(result?.content).toContain("Followers: 42");
    expect(result?.content).toContain("Open web search");
  });

  it("routes a Bluesky author feed through the public AT Protocol API", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okJsonResponse({
        feed: [
          {
            post: {
              author: { displayName: "OpenSearch", handle: "opensearch.test" },
              likeCount: 9,
              record: { text: "Public feed item" },
              repostCount: 2,
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://bsky.app/profile/opensearch.bsky.social/feed"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=opensearch.bsky.social&limit=10"
    );
    expect(result?.title).toBe("Bluesky feed opensearch.bsky.social");
    expect(result?.content).toContain("Public feed item");
    expect(result?.content).toContain("9 likes");
  });

  it("returns null when Bluesky profile responses are not public", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 403 }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://bsky.app/profile/private.example")
    ).toBeNull();
  });
});

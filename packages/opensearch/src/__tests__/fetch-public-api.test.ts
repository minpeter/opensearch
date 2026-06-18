import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicApiRouter,
  type PublicApiRoute,
} from "../fetch/public-api/registry.ts";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi", () => {
  it("leaves unmatched registry routes fail-closed without invoking providers", async () => {
    const routeFetch = vi.fn(async () => null);
    const routes: readonly PublicApiRoute[] = [
      {
        fetch: routeFetch,
        match: (url) => url.hostname === "matched.example",
        name: "matched",
      },
    ];
    const router = createPublicApiRouter(routes);

    expect(await router("https://unmatched.example/article")).toBeNull();
    expect(routeFetch).not.toHaveBeenCalled();
  });

  it("returns null for non-routed URLs without making a request", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    expect(await fetchViaPublicApi("https://example.com/article")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("routes a Reddit comments URL to the .json API", async () => {
    const body = JSON.stringify([
      {
        data: {
          children: [{ data: { selftext: "Body text", title: "Post title" } }],
        },
      },
      {
        data: {
          children: [
            { data: { body: "A comment" } },
            { data: { body: "More" } },
          ],
        },
      },
    ]);
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.reddit.com/r/rust/comments/abc/title/"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://www.reddit.com/r/rust/comments/abc/title.json"
    );
    expect(result?.title).toBe("Post title");
    expect(result?.content).toContain("Body text");
    expect(result?.content).toContain("A comment");
  });

  it("routes a Reddit subreddit hot listing to the .json API", async () => {
    const body = {
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
    };
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse(body));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.reddit.com/r/rust/hot/"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://www.reddit.com/r/rust/hot.json?limit=10"
    );
    expect(result?.title).toBe("r/rust hot");
    expect(result?.content).toContain("## r/rust hot");
    expect(result?.content).toContain("[Rust 1.99 Released]");
    expect(result?.content).toContain("by ferris");
    expect(result?.content).toContain("42 points");
    expect(result?.content).toContain("7 comments");
  });

  it("routes a Reddit subreddit search URL to the search .json API", async () => {
    const body = {
      data: {
        children: [
          {
            data: {
              author: "searcher",
              num_comments: 3,
              permalink: "/r/typescript/comments/abc/example/",
              score: 12,
              title: "Deno and TypeScript",
            },
          },
        ],
      },
    };
    const mockFetch = vi.fn().mockResolvedValue(okJsonResponse(body));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.reddit.com/r/typescript/search?q=deno"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://www.reddit.com/r/typescript/search.json?q=deno&restrict_sr=1&limit=10"
    );
    expect(result?.title).toBe('r/typescript search "deno"');
    expect(result?.content).toContain("## r/typescript search");
    expect(result?.content).toContain("[Deno and TypeScript]");
    expect(result?.content).toContain(
      "https://www.reddit.com/r/typescript/comments/abc/example/"
    );
  });

  it("routes a Hacker News item URL to the Firebase API", async () => {
    const body = JSON.stringify({
      by: "user",
      text: "HN text",
      title: "HN Title",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://news.ycombinator.com/item?id=12345"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://hacker-news.firebaseio.com/v0/item/12345.json"
    );
    expect(result?.title).toBe("HN Title");
    expect(result?.content).toContain("HN text");
  });

  it("routes Hacker News news list URLs through topstories and item APIs", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okJsonResponse([100, 101]))
      .mockResolvedValueOnce(
        okJsonResponse({
          by: "pg",
          descendants: 99,
          score: 500,
          title: "Launch HN: Example",
          url: "https://example.com/launch",
        })
      )
      .mockResolvedValueOnce(
        okJsonResponse({
          by: "dang",
          descendants: 12,
          score: 80,
          title: "Second Story",
          url: "https://example.com/second",
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi("https://news.ycombinator.com/news");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=10&orderBy=%22%24key%22"
    );
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(
      "https://hacker-news.firebaseio.com/v0/item/100.json"
    );
    expect(result?.title).toBe("Hacker News top stories");
    expect(result?.content).toContain("## Hacker News top stories");
    expect(result?.content).toContain("[Launch HN: Example]");
    expect(result?.content).toContain("500 points");
    expect(result?.content).toContain("99 comments");
  });

  it("routes Hacker News newest list URLs through newstories and item APIs", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(okJsonResponse([200]))
      .mockResolvedValueOnce(
        okJsonResponse({
          by: "newbie",
          descendants: 1,
          score: 5,
          title: "Fresh Story",
          url: "https://example.com/fresh",
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://news.ycombinator.com/newest"
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://hacker-news.firebaseio.com/v0/newstories.json?limitToFirst=10&orderBy=%22%24key%22"
    );
    expect(result?.title).toBe("Hacker News new stories");
    expect(result?.content).toContain("## Hacker News new stories");
    expect(result?.content).toContain("[Fresh Story]");
    expect(result?.content).toContain("by newbie");
  });

  it("returns null when the official API call fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://news.ycombinator.com/item?id=1")
    ).toBeNull();
  });
});

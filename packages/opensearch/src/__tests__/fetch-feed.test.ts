import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverFeedCandidates,
  fetchDiscoveredFeed,
  parseFeed,
} from "../fetch/feed.ts";
import { ARTICLE_HTML } from "./fetch-test-helpers.ts";
import { fetchUrl } from "./full-runtime.ts";

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <item>
      <title>First item</title>
      <link>https://example.com/1</link>
      <description>First summary</description>
    </item>
  </channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <title>Atom item</title>
    <link href="https://example.com/a" rel="alternate" />
    <summary>Atom summary</summary>
  </entry>
</feed>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("feed parsing and discovery", () => {
  it("parses RSS 2.0 into provenance-tagged markdown", () => {
    const result = parseFeed("https://example.com/rss", RSS_XML);
    expect(result?.title).toBe("Example RSS");
    expect(result?.content).toContain("First item");
    expect(result?.content).toContain("First summary");
  });

  it("parses Atom entries", () => {
    const result = parseFeed("https://example.com/atom.xml", ATOM_XML);

    expect(result?.title).toBe("Example Atom");
    expect(result?.content).toContain("Atom item");
    expect(result?.content).toContain("https://example.com/a");
  });

  it("discovers HTML alternates, Jina alternates, and transform feeds in order", () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    </head></html>`;

    const candidates = discoverFeedCandidates("https://www.example.com/post", {
      html,
      jinaAlternates: ["/atom.xml"],
    });

    expect(candidates.slice(0, 3)).toEqual([
      { name: "feed:html-alternate", url: "https://www.example.com/rss.xml" },
      { name: "feed:jina-alternate", url: "https://www.example.com/atom.xml" },
      {
        name: "feed:transform:rss_path",
        url: "https://www.example.com/post/rss",
      },
    ]);
  });

  it("continues past malformed XML and returns the first valid feed", async () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/bad.xml">
      <link rel="alternate" type="application/atom+xml" href="/good.xml">`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>"))
      .mockResolvedValueOnce(new Response(ATOM_XML));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchDiscoveredFeed("https://example.com/post", {
      html,
      includeTransforms: false,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result?.title).toBe("Example Atom");
  });
});

describe("feed local fallback", () => {
  it("parses a direct RSS response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(RSS_XML, {
            headers: { "Content-Type": "application/rss+xml" },
            status: 200,
          })
        )
      )
    );

    const result = await fetchUrl("https://example.com/rss.xml");
    expect(result.title).toBe("Example RSS");
  });

  it("keeps sufficient original content instead of fetching an alternate feed", async () => {
    const html = ARTICLE_HTML.replace(
      "</head>",
      '<link rel="alternate" type="application/rss+xml" href="/rss.xml"></head>'
    );
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          headers: { "Content-Type": "text/html" },
          status: 200,
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/full");

    const calledUrls = mockFetch.mock.calls.map(([input]) => String(input));
    expect(calledUrls.some((url) => url.includes("/rss.xml"))).toBe(false);
    expect(result.content).toContain("Test Heading");
  });
});

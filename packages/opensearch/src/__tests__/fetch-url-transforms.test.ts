import { describe, expect, it } from "vitest";
import {
  transformedUrlAttempts,
  transformedUrls,
} from "../fetch/url-transforms.ts";

describe("transformedUrls", () => {
  it("maps a www host to mobile and apex variants", () => {
    expect(transformedUrls("https://www.example.com/a?b=1")).toEqual([
      "https://m.example.com/a?b=1",
      "https://example.com/a?b=1",
      "https://www.example.com/a.json",
      "https://www.example.com/a/rss",
      "https://www.example.com/a/feed",
      "https://www.example.com/a/atom.xml",
      "https://www.example.com/a/rss.xml",
      "https://www.example.com/a/index.xml",
    ]);
  });

  it("maps an apex host to its mobile subdomain", () => {
    expect(transformedUrls("https://example.com/a")).toEqual([
      "https://m.example.com/a",
      "https://example.com/a.json",
      "https://example.com/a/rss",
      "https://example.com/a/feed",
      "https://example.com/a/atom.xml",
      "https://example.com/a/rss.xml",
      "https://example.com/a/index.xml",
    ]);
  });

  it("treats an apex under a compound TLD as apex, not a subdomain", () => {
    expect(transformedUrls("https://example.co.uk/a")).toEqual([
      "https://m.example.co.uk/a",
      "https://example.co.uk/a.json",
      "https://example.co.uk/a/rss",
      "https://example.co.uk/a/feed",
      "https://example.co.uk/a/atom.xml",
      "https://example.co.uk/a/rss.xml",
      "https://example.co.uk/a/index.xml",
    ]);
    expect(transformedUrls("https://example.com.au/a")).toEqual([
      "https://m.example.com.au/a",
      "https://example.com.au/a.json",
      "https://example.com.au/a/rss",
      "https://example.com.au/a/feed",
      "https://example.com.au/a/atom.xml",
      "https://example.com.au/a/rss.xml",
      "https://example.com.au/a/index.xml",
    ]);
  });

  it("skips deep subdomains and hosts already on m.", () => {
    expect(transformedUrls("https://docs.example.com/a")).toEqual([]);
    expect(transformedUrls("https://docs.example.co.uk/a")).toEqual([]);
    expect(transformedUrls("https://m.example.com/a")).toEqual([]);
  });

  it("returns [] for non-http(s) or invalid URLs", () => {
    expect(transformedUrls("ftp://example.com")).toEqual([]);
    expect(transformedUrls("not a url")).toEqual([]);
  });

  it("strips embedded Basic-auth credentials from variants", () => {
    const variants = transformedUrls("https://user:pass@www.example.com/a");
    expect(variants).toEqual([
      "https://m.example.com/a",
      "https://example.com/a",
      "https://www.example.com/a.json",
      "https://www.example.com/a/rss",
      "https://www.example.com/a/feed",
      "https://www.example.com/a/atom.xml",
      "https://www.example.com/a/rss.xml",
      "https://www.example.com/a/index.xml",
    ]);
    expect(variants.some((u) => u.includes("user") || u.includes("pass"))).toBe(
      false
    );
  });

  it("returns named attempts in retry and discovery order", () => {
    expect(transformedUrlAttempts("https://www.example.com/a?b=1")).toEqual([
      { name: "mobile_subdomain", url: "https://m.example.com/a?b=1" },
      { name: "drop_www", url: "https://example.com/a?b=1" },
      { name: "json_suffix", url: "https://www.example.com/a.json" },
      { name: "rss_path", url: "https://www.example.com/a/rss" },
      { name: "feed_path", url: "https://www.example.com/a/feed" },
      { name: "atom_xml_path", url: "https://www.example.com/a/atom.xml" },
      { name: "rss_xml_path", url: "https://www.example.com/a/rss.xml" },
      { name: "index_xml_path", url: "https://www.example.com/a/index.xml" },
    ]);
  });

  it("dedupes generated variants against the cleaned original", () => {
    expect(transformedUrlAttempts("https://example.com/feed")).toEqual([
      { name: "am_prefix", url: "https://m.example.com/feed" },
      { name: "json_suffix", url: "https://example.com/feed.json" },
      { name: "rss_path", url: "https://example.com/feed/rss" },
      { name: "feed_path", url: "https://example.com/feed/feed" },
      { name: "atom_xml_path", url: "https://example.com/feed/atom.xml" },
      { name: "rss_xml_path", url: "https://example.com/feed/rss.xml" },
      { name: "index_xml_path", url: "https://example.com/feed/index.xml" },
    ]);
  });

  it("keeps host retries but skips feed or json suffixes for asset URLs", () => {
    expect(transformedUrls("https://www.example.com/app.js")).toEqual([
      "https://m.example.com/app.js",
      "https://example.com/app.js",
    ]);
    expect(transformedUrls("https://example.com/report.pdf")).toEqual([
      "https://m.example.com/report.pdf",
    ]);
  });
});

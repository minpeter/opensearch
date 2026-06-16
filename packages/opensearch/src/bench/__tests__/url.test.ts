import { describe, expect, it } from "vitest";
import { canonicalUrl, hostKey, isHttpUrl, matchesLabel } from "../url.ts";

describe("isHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects non-web schemes and garbage", () => {
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("mailto:a@example.com")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("canonicalUrl", () => {
  it("strips www, trailing slash, and fragment; lowercases host", () => {
    expect(canonicalUrl("https://WWW.Example.com/Path/")).toBe(
      "example.com/Path"
    );
    expect(canonicalUrl("http://example.com/#section")).toBe("example.com");
  });

  it("drops tracking params but keeps and sorts real ones", () => {
    expect(
      canonicalUrl("https://example.com/p?utm_source=x&b=2&a=1&fbclid=z")
    ).toBe("example.com/p?a=1&b=2");
  });

  it("treats http and https as the same identity", () => {
    expect(canonicalUrl("http://example.com/p")).toBe(
      canonicalUrl("https://example.com/p")
    );
  });

  it("returns null for non-http(s) or unparseable URLs", () => {
    expect(canonicalUrl("ftp://example.com")).toBeNull();
    expect(canonicalUrl("garbage")).toBeNull();
  });

  it("re-encodes kept query params so values cannot collapse or corrupt the key", () => {
    // "a&b" as a single value must stay one param, not split into two.
    expect(canonicalUrl("https://example.com/s?q=a%26b")).toBe(
      "example.com/s?q=a%26b"
    );
    // A space in a value stays encoded rather than producing a raw space.
    expect(canonicalUrl("https://example.com/s?q=x y")).toBe(
      "example.com/s?q=x+y"
    );
  });
});

describe("hostKey", () => {
  it("derives a bare host from a URL or a bare domain", () => {
    expect(hostKey("https://www.example.com/path")).toBe("example.com");
    expect(hostKey("example.com")).toBe("example.com");
  });
});

describe("matchesLabel", () => {
  it("matches exact host and subdomains", () => {
    expect(matchesLabel("https://tokio.rs/tutorial", "tokio.rs")).toBe(true);
    expect(matchesLabel("https://docs.example.com/x", "example.com")).toBe(
      true
    );
    expect(matchesLabel("https://www.example.com", "example.com")).toBe(true);
  });

  it("does not false-positive on a suffix that is not a dot boundary", () => {
    expect(matchesLabel("https://notexample.com", "example.com")).toBe(false);
    expect(matchesLabel("https://evil-example.com", "example.com")).toBe(false);
  });

  it("honors a path when the label carries one", () => {
    expect(
      matchesLabel("https://example.com/docs/handbook", "example.com/docs")
    ).toBe(true);
    expect(matchesLabel("https://example.com/docs", "example.com/docs")).toBe(
      true
    );
    expect(matchesLabel("https://example.com/blog", "example.com/docs")).toBe(
      false
    );
  });

  it("requires a path-segment boundary (no prefix false-positives)", () => {
    expect(
      matchesLabel(
        "https://example.com/docs-internal/secret",
        "example.com/docs"
      )
    ).toBe(false);
    expect(matchesLabel("https://example.com/ppt", "example.com/p")).toBe(
      false
    );
  });

  it("ignores a query string when boundary-matching a path label", () => {
    expect(
      matchesLabel("https://example.com/docs?ref=x", "example.com/docs")
    ).toBe(true);
  });

  it("matches full-URL labels by host even with trailing slash/query drift", () => {
    expect(
      matchesLabel(
        "https://www.typescriptlang.org/?x=1",
        "https://typescriptlang.org/"
      )
    ).toBe(true);
  });

  it("returns false for unparseable result URLs", () => {
    expect(matchesLabel("garbage", "example.com")).toBe(false);
  });

  it("rejects non-http(s) result URLs even when the host matches", () => {
    expect(matchesLabel("ftp://example.com", "example.com")).toBe(false);
    expect(matchesLabel("mailto:hi@example.com", "example.com")).toBe(false);
  });
});

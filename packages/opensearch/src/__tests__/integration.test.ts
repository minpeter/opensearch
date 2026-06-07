import { describe, expect, it } from "vitest";

import { fetchUrl } from "../fetch.ts";
import { search } from "../search.ts";

const HTML_TAG_PATTERN = /<html/i;
const BODY_TAG_PATTERN = /<body/i;
const DIV_TAG_PATTERN = /<div/i;
const BLOCKED_OR_RATE_LIMIT_PATTERNS = [
  /All search engines failed/i,
  /Bot detected/i,
  /Search failed across all engines/i,
  /Too many requests/i,
  /unusual traffic/i,
] as const;

const isBlockedOrRateLimitedError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }

  return BLOCKED_OR_RATE_LIMIT_PATTERNS.some((pattern) =>
    pattern.test(error.message)
  );
};

describe("integration: web_search (real network)", () => {
  it('search("typescript programming language") returns results with all fields', {
    timeout: 15_000,
  }, async () => {
    let results: Awaited<ReturnType<typeof search>>;
    try {
      results = await search("typescript programming language");
    } catch (err) {
      if (isBlockedOrRateLimitedError(err)) {
        console.warn(
          "Search engines rate-limited or blocked — skipping assertion"
        );
        return;
      }
      throw err;
    }

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(
      results.every((r) => r.title && r.url && r.snippet && r.engine)
    ).toBe(true);
  });
});

describe("integration: web_fetch (real network)", () => {
  it('fetchUrl("https://example.com") returns markdown content', {
    timeout: 30_000,
  }, async () => {
    const result = await fetchUrl("https://example.com");

    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.url).toBe("https://example.com");
    expect(result.length).toBeGreaterThan(0);

    expect(result.content).not.toMatch(HTML_TAG_PATTERN);
    expect(result.content).not.toMatch(BODY_TAG_PATTERN);
    expect(result.content).not.toMatch(DIV_TAG_PATTERN);
  });
});

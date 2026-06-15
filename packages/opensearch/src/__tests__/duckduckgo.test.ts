import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDuckDuckGoProvider,
  parseDuckDuckGoJson,
} from "../search/duckduckgo.ts";
import { createMockResponse, resetSearchEnv } from "./search-test-helpers.ts";

describe("parseDuckDuckGoJson", () => {
  it("maps t/u/a and decodes HTML entities and tags", () => {
    const body = JSON.stringify({
      results: [
        {
          a: "Async <b>runtime</b> for Rust",
          t: "Tokio",
          u: "https://tokio.rs",
        },
        { a: "API docs &amp; guides", t: "Docs", u: "https://docs.rs/tokio" },
      ],
    });
    expect(parseDuckDuckGoJson(body)).toEqual([
      {
        snippet: "Async runtime for Rust",
        title: "Tokio",
        url: "https://tokio.rs",
      },
      {
        snippet: "API docs & guides",
        title: "Docs",
        url: "https://docs.rs/tokio",
      },
    ]);
  });

  it("drops entries missing title/url and dedupes by url", () => {
    const body = JSON.stringify({
      results: [
        { a: "x", t: "", u: "https://a.com" },
        { a: "x", t: "A", u: "https://a.com" },
        { a: "y", t: "A dup", u: "https://a.com" },
        { n: "/d.js?next" },
      ],
    });
    expect(parseDuckDuckGoJson(body)).toEqual([
      { snippet: "x", title: "A", url: "https://a.com" },
    ]);
  });

  it("returns [] for invalid JSON or unexpected shape", () => {
    expect(parseDuckDuckGoJson("not json")).toEqual([]);
    expect(parseDuckDuckGoJson(JSON.stringify({ foo: 1 }))).toEqual([]);
  });
});

describe("createDuckDuckGoProvider", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("escalates to the d.js PoW bypass when the html scrape is bot-blocked", async () => {
    process.env.OPENSEARCH_ENABLE_DUCKDUCKGO_POW = "true";
    const challenge =
      "let jsa=21;let f=function(n){return n*2;};jsa=f(jsa);DDG.deep.initialize('0&jsa_hash=deadbeef0123&jsa='+jsa);";
    const resultsJson = JSON.stringify({
      results: [
        { a: "Async <b>runtime</b>", t: "Tokio", u: "https://tokio.rs" },
      ],
    });
    const mockFetch = vi
      .fn()
      // 1) html.duckduckgo.com scrape -> bot challenge page -> blocked
      .mockResolvedValueOnce(
        createMockResponse('<div class="challenge-form"></div>')
      )
      // 2) duckduckgo.com homepage -> vqd token
      .mockResolvedValueOnce(
        createMockResponse('<script>vqd="abc-123";</script>')
      )
      // 3) links d.js -> JS proof-of-work challenge
      .mockResolvedValueOnce(createMockResponse(challenge))
      // 4) links d.js + solved token -> results JSON
      .mockResolvedValueOnce(createMockResponse(resultsJson));
    vi.stubGlobal("fetch", mockFetch);

    const results = await createDuckDuckGoProvider().search("rust async", 5);

    expect(results).toEqual([
      {
        engine: "DuckDuckGo",
        snippet: "Async runtime",
        title: "Tokio",
        url: "https://tokio.rs",
      },
    ]);
    // The final request must carry the solved proof-of-work token.
    expect(String(mockFetch.mock.calls[3]?.[0])).toContain(
      "jsa_hash=deadbeef0123&jsa=42"
    );
  });

  it("does not escalate when the html scrape returns results", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse(`
        <div class="result results_links">
          <a class="result__a" href="https://example.com">Example</a>
          <div class="result__snippet">A snippet.</div>
        </div>
      `)
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await createDuckDuckGoProvider().search("q", 5);

    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

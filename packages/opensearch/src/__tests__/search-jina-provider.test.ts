import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search } from "../search.ts";
import { createMockResponse, resetSearchEnv } from "./search-test-helpers.ts";

describe("Jina Search provider", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("uses authenticated s.jina.ai path search and parses SERP markdown", async () => {
    process.env.JINA_API_KEY = "jina-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse(`
[1] Title: Jina Reader
[1] URL Source: https://jina.ai/reader
[1] Description: Search the web and convert results to LLM-friendly text.
[1] Date: Jun 7, 2026

[2] Title: Jina GitHub
[2] URL Source: https://github.com/jina-ai/reader
[2] Description: Open source Reader implementation.
`)
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("jina reader search", 2);

    expect(results).toEqual([
      {
        engine: "Jina",
        snippet: "Search the web and convert results to LLM-friendly text.",
        title: "Jina Reader",
        url: "https://jina.ai/reader",
      },
      {
        engine: "Jina",
        snippet: "Open source Reader implementation.",
        title: "Jina GitHub",
        url: "https://github.com/jina-ai/reader",
      },
    ]);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://s.jina.ai/jina%20reader%20search");
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jina-key",
          "X-Respond-With": "no-content",
        }),
        method: "GET",
        redirect: "manual",
      })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchEngineError } from "../search/errors.ts";
import { createAugmentedBingProvider } from "../search/providers-augmented-bing.ts";
import { resetSearchEnv } from "./search-test-helpers.ts";

interface PendingFetch {
  readonly resolve: (response: Response) => void;
  readonly url: string;
}

describe("augmented Bing zero-key provider", () => {
  beforeEach(() => {
    resetSearchEnv();
    process.env.OPENSEARCH_INTERNET_ARCHIVE_URL = "http://localhost/archive";
    process.env.OPENSEARCH_WIBY_URL = "http://localhost/wiby";
    process.env.OPENSEARCH_WIKIPEDIA_URL = "http://localhost/wikipedia";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("runs Bing with niche zero-key sources in parallel and merges Bing-first results", async () => {
    const pendingFetches: PendingFetch[] = [];
    const mockFetch = vi.fn((url: URL | RequestInfo) => {
      const requestUrl = String(url);
      return new Promise<Response>((resolve) => {
        pendingFetches.push({ resolve, url: requestUrl });
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const searchPromise = createAugmentedBingProvider().search("github", 6);

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
    const pendingUrls = pendingFetches.map((pending) => pending.url);
    expect(pendingUrls).toContain(
      "https://www.bing.com/search?q=github&setlang=en-US"
    );
    expect(pendingUrls).toContain(
      "http://localhost/wikipedia?action=query&format=json&list=search&origin=*&srlimit=6&srsearch=github"
    );
    expect(pendingUrls).toContain("http://localhost/wiby?q=github");
    expect(
      pendingUrls.some((url) => url.startsWith("http://localhost/archive?"))
    ).toBe(true);

    resolvePendingFetch(
      pendingFetches,
      "bing.com/search",
      createHtmlResponse(`
        <ol>
          <li class="b_algo">
            <h2><a href="https://github.com/">GitHub</a></h2>
            <div class="b_caption"><p>Bing primary result.</p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://docs.github.com/">GitHub Docs</a></h2>
            <div class="b_caption"><p>Bing docs result.</p></div>
          </li>
          <li class="b_algo">
            <h2><a href="https://github.blog/">GitHub Blog</a></h2>
            <div class="b_caption"><p>Bing blog result.</p></div>
          </li>
        </ol>
      `)
    );
    resolvePendingFetch(
      pendingFetches,
      "localhost/wikipedia",
      createJsonResponse({
        query: {
          search: [
            {
              pageid: 123,
              snippet: "Wikipedia factual supplement.",
              title: "GitHub",
            },
          ],
        },
      })
    );
    resolvePendingFetch(
      pendingFetches,
      "localhost/archive",
      createJsonResponse({
        response: {
          docs: [
            {
              description: "Internet Archive historical supplement.",
              identifier: "github-archive",
              title: "GitHub Archive",
            },
          ],
        },
      })
    );
    resolvePendingFetch(
      pendingFetches,
      "localhost/wiby",
      createHtmlResponse(`
        <blockquote>
          <a class="tlink" href="https://example.com/small-web">Small GitHub Guide</a>
          <p class="url">https://example.com/small-web</p>
          <p>Wiby small-web supplement.</p>
        </blockquote>
      `)
    );

    await expect(searchPromise).resolves.toEqual([
      {
        engine: "Bing",
        snippet: "Bing primary result.",
        title: "GitHub",
        url: "https://github.com/",
      },
      {
        engine: "Bing",
        snippet: "Bing docs result.",
        title: "GitHub Docs",
        url: "https://docs.github.com/",
      },
      {
        engine: "Bing",
        snippet: "Bing blog result.",
        title: "GitHub Blog",
        url: "https://github.blog/",
      },
      {
        engine: "Wikipedia",
        snippet: "Wikipedia factual supplement.",
        title: "GitHub",
        url: "https://en.wikipedia.org/?curid=123",
      },
      {
        engine: "Wiby",
        snippet: "Wiby small-web supplement.",
        title: "Small GitHub Guide",
        url: "https://example.com/small-web",
      },
      {
        engine: "InternetArchive",
        snippet: "Internet Archive historical supplement.",
        title: "GitHub Archive",
        url: "https://archive.org/details/github-archive",
      },
    ]);
  });

  it("reports a transient failure when all merged results are empty and a supplement fails", async () => {
    const mockFetch = vi.fn((url: URL | RequestInfo) => {
      const requestUrl = String(url);

      if (requestUrl.includes("bing.com/search")) {
        return Promise.resolve(createHtmlResponse("<ol></ol>"));
      }

      if (requestUrl.includes("localhost/wiby")) {
        return Promise.resolve(createHtmlResponse("blocked", 503));
      }

      if (requestUrl.includes("localhost/archive")) {
        return Promise.resolve(
          createJsonResponse({
            response: { docs: [] },
          })
        );
      }

      return Promise.resolve(
        createJsonResponse({
          query: { search: [] },
        })
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      createAugmentedBingProvider().search("github", 6)
    ).rejects.toMatchObject({
      engine: "Bing",
      kind: "transient",
    } satisfies Partial<SearchEngineError>);
  });
});

function createHtmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
    status,
  });
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function resolvePendingFetch(
  pendingFetches: readonly PendingFetch[],
  urlPart: string,
  response: Response
): void {
  const pendingFetch = pendingFetches.find((pending) =>
    pending.url.includes(urlPart)
  );

  if (!pendingFetch) {
    throw new Error(`No pending fetch matched ${urlPart}`);
  }

  pendingFetch.resolve(response);
}

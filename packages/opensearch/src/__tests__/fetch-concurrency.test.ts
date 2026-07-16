import { afterEach, describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "../fetch/concurrency.ts";
import { createOpenSearch } from "../index.ts";

interface ConcurrencyMetrics {
  active: number;
  calls: number;
  peak: number;
  requestedUrls: string[];
}

const FIRECRAWL_ENV = {
  OPENSEARCH_ENABLE_FIRECRAWL: "true",
} as const;

function stubFirecrawlFetch(delayMs = 2): ConcurrencyMetrics {
  const metrics: ConcurrencyMetrics = {
    active: 0,
    calls: 0,
    peak: 0,
    requestedUrls: [],
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const requestedUrl = readRequestUrl(init);
      metrics.active += 1;
      metrics.calls += 1;
      metrics.peak = Math.max(metrics.peak, metrics.active);
      metrics.requestedUrls.push(requestedUrl);

      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return new Response(
          JSON.stringify({
            data: {
              markdown: `# ${requestedUrl}`,
              metadata: null,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        );
      } finally {
        metrics.active -= 1;
      }
    })
  );

  return metrics;
}

function readRequestUrl(init?: RequestInit): string {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }

  const body: unknown = JSON.parse(init.body);
  if (!(body && typeof body === "object" && "url" in body)) {
    throw new Error("Expected a URL in the request body.");
  }

  const { url } = body;
  if (typeof url !== "string") {
    throw new Error("Expected the request URL to be a string.");
  }

  return url;
}

describe("fetch batch concurrency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates misses and caps default per-URL provider work at eight", async () => {
    const metrics = stubFirecrawlFetch();
    const client = createOpenSearch({ env: FIRECRAWL_ENV });
    const urls = Array.from(
      { length: 100 },
      (_value, index) => `https://example.com/repeated-${index % 10}`
    );

    const results = await client.fetch(urls, { maxCharacters: 1000 });

    expect(metrics.calls).toBe(10);
    expect(metrics.peak).toBe(8);
    expect(metrics.requestedUrls.toSorted()).toStrictEqual(
      [...new Set(urls)].toSorted()
    );
    expect(results).toHaveLength(urls.length);
    expect(results.map((result) => result.url)).toStrictEqual(urls);
    expect(results.map((result) => result.content)).toStrictEqual(
      urls.map((url) => `# ${url}`)
    );
  });

  it("supports client defaults and per-call concurrency overrides", async () => {
    const configuredMetrics = stubFirecrawlFetch();
    const configuredClient = createOpenSearch({
      env: FIRECRAWL_ENV,
      fetch: { maxConcurrency: 3 },
    });
    const configuredUrls = Array.from(
      { length: 12 },
      (_value, index) => `https://example.com/configured-${index}`
    );

    await configuredClient.fetch(configuredUrls, { maxCharacters: 1000 });
    expect(configuredMetrics.peak).toBe(3);

    vi.restoreAllMocks();
    const overriddenMetrics = stubFirecrawlFetch();
    const overriddenClient = createOpenSearch({
      env: FIRECRAWL_ENV,
      fetch: { maxConcurrency: 2 },
    });
    const overriddenUrls = Array.from(
      { length: 10 },
      (_value, index) => `https://example.com/overridden-${index}`
    );

    await overriddenClient.fetch(overriddenUrls, {
      maxCharacters: 1000,
      maxConcurrency: 5,
    });
    expect(overriddenMetrics.peak).toBe(5);
  });

  it("rejects invalid client and per-call concurrency", async () => {
    expect(() =>
      createOpenSearch({
        env: FIRECRAWL_ENV,
        fetch: { maxConcurrency: 0 },
      })
    ).toThrow("maxConcurrency must be a positive safe integer");

    const client = createOpenSearch({ env: FIRECRAWL_ENV });
    await expect(client.fetch([], { maxConcurrency: 1.5 })).rejects.toThrow(
      "maxConcurrency must be a positive safe integer"
    );
  });

  it("settles active workers and stops scheduling after a mapper failure", async () => {
    let active = 0;
    let started = 0;

    const operation = mapWithConcurrency(
      Array.from({ length: 20 }, (_value, index) => index),
      3,
      async (index) => {
        active += 1;
        started += 1;
        try {
          await new Promise((resolve) =>
            setTimeout(resolve, index === 0 ? 1 : 5)
          );
          if (index === 0) {
            throw new Error("expected mapper failure");
          }
          return index;
        } finally {
          active -= 1;
        }
      }
    );

    await expect(operation).rejects.toThrow("expected mapper failure");
    expect(active).toBe(0);
    expect(started).toBe(3);
  });
});

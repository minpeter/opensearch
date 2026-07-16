import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentReader } from "../environment.ts";
import { createFirecrawlSearchProvider } from "../search/providers/firecrawl.ts";

const environment = createEnvironmentReader({
  OPENSEARCH_ENABLE_FIRECRAWL: "true",
});

describe("Firecrawl search failure semantics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves HTTP 429 as a retryable, measurable provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "You've hit Firecrawl's keyless free tier rate limit",
          }),
          { status: 429 }
        )
      )
    );
    const provider = createFirecrawlSearchProvider(environment);

    await expect(provider?.search("rate limit", 3)).rejects.toMatchObject({
      engine: "Firecrawl",
      kind: "transient",
      status: 429,
    });
  });

  it.each([
    [401, "misconfigured"],
    [402, "misconfigured"],
    [403, "blocked"],
    [451, "blocked"],
    [503, "transient"],
  ] as const)("classifies HTTP %i as %s", async (status, kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream failure", { status }))
    );
    const provider = createFirecrawlSearchProvider(environment);

    await expect(provider?.search("failure", 3)).rejects.toMatchObject({
      engine: "Firecrawl",
      kind,
      status,
    });
  });
});

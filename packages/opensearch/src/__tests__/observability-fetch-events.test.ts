import { describe, expect, it, vi } from "vitest";

import {
  createOpenSearchWithRuntime,
  type OpenSearchEvent,
} from "../client.ts";
import { createFetchResult } from "../fetch/result.ts";
import { DISABLE_HOSTED_ENV } from "./observability-test-helpers.ts";

describe("OpenSearch fetch observability", () => {
  it("emits fetch provider and cache events without exposing URLs", async () => {
    const events: OpenSearchEvent[] = [];
    const localFetch = vi.fn(async (requestedUrl: string) =>
      createFetchResult(requestedUrl, "Observed local content", "Observed page")
    );
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      { localFetch }
    );
    const url = "https://private-query.example.org/observed";

    await client.fetch(url);
    await client.fetch(url);

    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "fetch",
          phase: "empty",
          provider: "public-api",
          type: "provider",
        }),
        expect.objectContaining({
          fromProvider: "public-api",
          toProvider: "local",
          type: "fallback",
        }),
        expect.objectContaining({
          operation: "fetch",
          phase: "success",
          provider: "local",
          type: "provider",
        }),
        expect.objectContaining({ status: "miss", type: "cache" }),
        expect.objectContaining({ status: "hit", type: "cache" }),
      ])
    );
    expect(JSON.stringify(events)).not.toContain(url);
  });

  it("records a public-API fallback for the unresolved part of a mixed batch", async () => {
    const events: OpenSearchEvent[] = [];
    const redditUrl = "https://www.reddit.com/r/x/comments/abc/title/";
    const genericUrl = "https://example.com/generic";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            data: {
              children: [{ data: { selftext: "Body", title: "Post" } }],
            },
          },
          { data: { children: [] } },
        ])
      )
    );
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      {
        localFetch: async (url) =>
          createFetchResult(url, "Local content", "Local page"),
      }
    );

    const results = await client.fetch([redditUrl, genericUrl]);

    expect(results.map((result) => result.title)).toEqual([
      "Post",
      "Local page",
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromProvider: "public-api",
          reason: "empty",
          toProvider: "local",
          type: "fallback",
        }),
      ])
    );
  });

  it("records provider and operation failures", async () => {
    const events: OpenSearchEvent[] = [];
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      {
        localFetch: () => Promise.reject(new Error("local extraction failed")),
      }
    );

    await expect(client.fetch("https://example.com/failure")).rejects.toThrow(
      "local extraction failed"
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "failure",
          provider: "local",
          type: "provider",
        }),
        expect.objectContaining({
          operation: "fetch",
          phase: "failure",
          type: "operation",
        }),
      ])
    );
  });
});

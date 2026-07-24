import { describe, expect, it, vi } from "vitest";

import {
  createOpenSearchWithRuntime,
  type OpenSearchEvent,
} from "../client.ts";
import type { OpenSearchOperationEvent } from "../observability.ts";
import { SearchEngineError } from "../search/errors.ts";
import type { SearchProvider } from "../search/types.ts";
import {
  DISABLE_HOSTED_ENV,
  searchResult,
  successfulSearchProvider,
} from "./observability-test-helpers.ts";

describe("OpenSearch search observability", () => {
  it("emits search attempts, fallback, latency, and cache status", async () => {
    const events: OpenSearchEvent[] = [];
    const firstProvider: SearchProvider = {
      name: "Brave",
      search: vi
        .fn()
        .mockRejectedValue(
          new SearchEngineError(
            "Brave",
            "transient",
            "upstream reflected sensitive query and https://secret.example/",
            { status: 503 }
          )
        ),
    };
    const secondProvider = successfulSearchProvider();
    const client = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: (event) => {
            events.push(event);
          },
        },
      },
      { searchProviders: () => [firstProvider, secondProvider] }
    );

    await expect(client.search("sensitive query", 3)).resolves.toEqual([
      searchResult,
    ]);
    await expect(client.search("sensitive query", 3)).resolves.toEqual([
      searchResult,
    ]);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureKind: "transient",
          operation: "search",
          phase: "failure",
          provider: "Brave",
          status: 503,
          type: "provider",
        }),
        expect.objectContaining({
          fromProvider: "Brave",
          reason: "transient",
          toProvider: "DuckDuckGo",
          type: "fallback",
        }),
        expect.objectContaining({
          operation: "search",
          phase: "success",
          provider: "DuckDuckGo",
          resultCount: 1,
          type: "provider",
        }),
        expect.objectContaining({ status: "miss", type: "cache" }),
        expect.objectContaining({ status: "hit", type: "cache" }),
      ])
    );

    const completedOperations = events.filter(
      (event): event is OpenSearchOperationEvent =>
        event.type === "operation" && event.phase === "success"
    );
    expect(completedOperations).toHaveLength(2);
    expect(
      completedOperations.every(
        (event) => event.durationMs !== undefined && event.durationMs >= 0
      )
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("sensitive query");
    expect(JSON.stringify(events)).not.toContain("secret.example");
  });
});

import { describe, expect, it } from "vitest";

import { createOpenSearchWithRuntime } from "../client.ts";
import { createOpenSearchObserver } from "../observability.ts";
import {
  DISABLE_HOSTED_ENV,
  searchResult,
  successfulSearchProvider,
} from "./observability-test-helpers.ts";

describe("OpenSearch observer isolation", () => {
  it("keeps operation IDs unique across client observers", () => {
    const firstObserver = createOpenSearchObserver();
    const secondObserver = createOpenSearchObserver();

    expect(firstObserver.createOperationId("search")).not.toBe(
      secondObserver.createOperationId("search")
    );
  });

  it("isolates synchronous throws and async rejections from event sinks", async () => {
    const provider = successfulSearchProvider();
    const throwingClient = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: () => {
            throw new Error("sink failed");
          },
        },
      },
      { searchProviders: () => [provider] }
    );
    const rejectingClient = createOpenSearchWithRuntime(
      {
        env: DISABLE_HOSTED_ENV,
        observability: {
          onEvent: () => Promise.reject(new Error("async sink failed")),
        },
      },
      { searchProviders: () => [provider] }
    );

    await expect(throwingClient.search("query one")).resolves.toEqual([
      searchResult,
    ]);
    await expect(rejectingClient.search("query two")).resolves.toEqual([
      searchResult,
    ]);
    await Promise.resolve();
  });
});

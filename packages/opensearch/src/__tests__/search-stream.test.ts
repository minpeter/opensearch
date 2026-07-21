import { describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../search/types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function results(engine: SearchResult["engine"]): SearchResult[] {
  return [
    {
      engine,
      snippet: `${engine} snippet`,
      title: `${engine} title`,
      url: `https://${engine}.example.com`,
    },
  ];
}

const slowProvider = deferred<SearchResult[]>();
const fastProvider = deferred<SearchResult[]>();
const failingProvider = deferred<SearchResult[]>();

vi.mock("../search/providers.ts", () => ({
  getSearchProviders: vi.fn().mockReturnValue([
    {
      name: "Brave",
      search: vi.fn().mockReturnValue(slowProvider.promise),
    },
    {
      name: "Exa",
      search: vi.fn().mockReturnValue(failingProvider.promise),
    },
    {
      name: "Tavily",
      search: vi.fn().mockReturnValue(fastProvider.promise),
    },
  ]),
}));

describe("searchStream", () => {
  it("yields each provider's results as they arrive, fastest first", async () => {
    const { searchStream } = await import("../search.ts");
    const batches: SearchResult[][] = [];
    let firstYieldAt = 0;

    const consume = (async () => {
      for await (const batch of searchStream("stream query", 3)) {
        if (firstYieldAt === 0) {
          firstYieldAt = Date.now();
        }
        batches.push(batch);
      }
    })();

    fastProvider.resolve(results("Tavily"));
    await vi.waitFor(() => expect(firstYieldAt).not.toBe(0));

    const slowStillPending = Promise.race([
      consume.then(() => "done"),
      Promise.resolve("pending"),
    ]);
    expect(await slowStillPending).toBe("pending");

    slowProvider.resolve(results("Brave"));
    failingProvider.reject(new Error("provider down"));
    await consume;

    expect(batches.map((batch) => batch[0]?.engine)).toEqual([
      "Tavily",
      "Brave",
    ]);
  });

  it("throws the aggregated error when every provider fails", async () => {
    const { searchStream } = await import("../search.ts");
    const failing = deferred<SearchResult[]>();
    const { getSearchProviders } = await import("../search/providers.ts");
    vi.mocked(getSearchProviders).mockReturnValueOnce([
      { name: "Brave", search: vi.fn().mockReturnValue(failing.promise) },
    ]);

    const consume = (async () => {
      const collected: SearchResult[][] = [];
      for await (const batch of searchStream("all fail", 3)) {
        collected.push(batch);
      }
      return collected;
    })();

    failing.reject(new Error("provider down"));
    await expect(consume).rejects.toThrow("Search failed across all engines");
  });
});

import { describe, expect, it } from "vitest";
import { SearchEngineError } from "../../search/errors.ts";
import type {
  SearchEngineName,
  SearchProvider,
  SearchResult,
} from "../../search/types.ts";
import { runBenchmark } from "../runner.ts";
import type { Clock } from "../types.ts";

function scriptedClock(values: number[]): Clock {
  let index = 0;
  return {
    now: () => {
      const value = values[index] ?? 0;
      index += 1;
      return value;
    },
  };
}

function results(engine: SearchEngineName, count: number): SearchResult[] {
  return Array.from({ length: count }, (_unused, i) => ({
    engine,
    snippet: "snippet",
    title: `Title ${i}`,
    url: `https://example.com/${i}`,
  }));
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("runBenchmark", () => {
  it("records latency and results for a successful probe", async () => {
    const provider: SearchProvider = {
      name: "Brave",
      search: () => Promise.resolve(results("Brave", 3)),
    };
    const probes = await runBenchmark({
      clock: scriptedClock([0, 150]),
      concurrency: 1,
      numResults: 5,
      providers: [provider],
      queries: [{ query: "q1" }],
    });
    expect(probes).toHaveLength(1);
    expect(probes[0]?.ok).toBe(true);
    expect(probes[0]?.latencyMs).toBe(150);
    expect(probes[0]?.results).toHaveLength(3);
  });

  it("preserves SearchEngineError kind and status on failure", async () => {
    const provider: SearchProvider = {
      name: "Brave",
      search: () =>
        Promise.reject(
          new SearchEngineError("Brave", "blocked", "Brave failed with 429", {
            status: 429,
          })
        ),
    };
    const probes = await runBenchmark({
      clock: scriptedClock([0, 10]),
      concurrency: 1,
      numResults: 5,
      providers: [provider],
      queries: [{ query: "q1" }],
    });
    expect(probes[0]?.ok).toBe(false);
    expect(probes[0]?.errorKind).toBe("blocked");
    expect(probes[0]?.status).toBe(429);
    expect(probes[0]?.timedOut).toBe(false);
  });

  it("marks a transient timeout-shaped error as timed out", async () => {
    const provider: SearchProvider = {
      name: "Tavily",
      search: () =>
        Promise.reject(
          new SearchEngineError(
            "Tavily",
            "transient",
            "Tavily fetch failed: The operation was aborted due to timeout"
          )
        ),
    };
    const probes = await runBenchmark({
      clock: scriptedClock([0, 10]),
      concurrency: 1,
      numResults: 5,
      providers: [provider],
      queries: [{ query: "q1" }],
    });
    expect(probes[0]?.ok).toBe(false);
    expect(probes[0]?.timedOut).toBe(true);
  });

  it("enforces the runner deadline for a slow provider", async () => {
    const provider: SearchProvider = {
      name: "Exa",
      search: async () => {
        await delay(60);
        return results("Exa", 1);
      },
    };
    const probes = await runBenchmark({
      concurrency: 1,
      deadlineMs: 20,
      numResults: 5,
      providers: [provider],
      queries: [{ query: "q1" }],
    });
    expect(probes[0]?.ok).toBe(false);
    expect(probes[0]?.timedOut).toBe(true);
    expect(probes[0]?.message).toContain("deadline");
  });

  it("runs a provider's queries sequentially", async () => {
    const events: string[] = [];
    const provider: SearchProvider = {
      name: "Brave",
      search: async (query) => {
        events.push(`start:${query}`);
        await delay(15);
        events.push(`end:${query}`);
        return results("Brave", 1);
      },
    };
    await runBenchmark({
      concurrency: 4,
      numResults: 5,
      providers: [provider],
      queries: [{ query: "a" }, { query: "b" }],
    });
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("runs providers concurrently up to the limit", async () => {
    let active = 0;
    let maxActive = 0;
    const make = (name: SearchEngineName): SearchProvider => ({
      name,
      search: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
        return results(name, 1);
      },
    });
    await runBenchmark({
      concurrency: 2,
      numResults: 5,
      providers: [make("Brave"), make("Exa"), make("Tavily")],
      queries: [{ query: "q1" }],
    });
    expect(maxActive).toBe(2);
  });
});

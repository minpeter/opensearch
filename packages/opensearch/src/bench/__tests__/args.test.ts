import { describe, expect, it } from "vitest";
import { parseArgs } from "../args.ts";

describe("parseArgs", () => {
  it("ignores the `--` end-of-options separator forwarded by pnpm", () => {
    // Regression: `pnpm run bench:live -- --num-results 5` forwards a literal
    // `--`, which previously threw "Unknown flag: --" and broke monitor.yml.
    const options = parseArgs([
      "--live",
      "--",
      "--num-results",
      "5",
      "--exclude",
      "DuckDuckGo,Bing",
    ]);
    expect(options.mode).toBe("live");
    expect(options.numResults).toBe(5);
    expect([...options.exclude].sort()).toEqual(["Bing", "DuckDuckGo"]);
  });

  it("defaults to offline mode with no flags", () => {
    expect(parseArgs([]).mode).toBe("offline");
  });

  it("parses string and path flags", () => {
    const options = parseArgs([
      "--queries",
      "q.json",
      "--out",
      "r.json",
      "--charts",
      "out/charts",
    ]);
    expect(options.queries).toBe("q.json");
    expect(options.out).toBe("r.json");
    expect(options.charts).toBe("out/charts");
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unknown flag: --nope");
  });

  it("rejects empty, non-positive, or non-finite numeric flags", () => {
    expect(() => parseArgs(["--num-results", ""])).toThrow();
    expect(() => parseArgs(["--num-results", "0"])).toThrow();
    expect(() => parseArgs(["--num-results", "-3"])).toThrow();
    expect(() => parseArgs(["--num-results", "abc"])).toThrow();
  });
});

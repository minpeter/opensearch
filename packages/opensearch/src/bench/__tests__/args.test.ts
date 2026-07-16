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
      "DuckDuckGo,Parallel",
      "--health-gate",
      "--fail-on-regression",
    ]);
    expect(options.mode).toBe("live");
    expect(options.numResults).toBe(5);
    expect([...options.exclude].sort()).toEqual(["DuckDuckGo", "Parallel"]);
    expect(options.healthGate).toBe(true);
    expect(options.failOnRegression).toBe(true);
  });

  it("defaults to offline mode with no flags", () => {
    const options = parseArgs([]);
    expect(options.mode).toBe("offline");
    expect(options.healthGate).toBe(false);
    expect(options.failOnRegression).toBe(false);
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

  it("rejects a value-flag whose value is missing or is another flag", () => {
    // Regression (cubic P1): `--out --markdown r.md` must NOT store "--markdown"
    // as the out path and silently drop --markdown.
    expect(() => parseArgs(["--out", "--markdown", "r.md"])).toThrow();
    expect(() => parseArgs(["--out"])).toThrow();
    expect(() => parseArgs(["--queries"])).toThrow();
  });

  it("rejects non-integer count flags", () => {
    // Regression (cubic P2): count flags are integers, not fractions.
    expect(() => parseArgs(["--num-results", "2.5"])).toThrow();
    expect(() => parseArgs(["--top-k", "1.5"])).toThrow();
    expect(() => parseArgs(["--concurrency", "0.5"])).toThrow();
  });
});

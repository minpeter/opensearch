import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOfflineReport } from "../fixtures.ts";
import type { BenchReport } from "../types.ts";

/**
 * The per-PR offline gate. Recomputes the report from committed fixtures and
 * asserts it equals the committed golden file. Any change to the metric math
 * shows up here as a reviewed diff to golden-report.json — there is no escape
 * hatch, and because every input is deterministic there is zero flakiness.
 */
describe("offline golden report", () => {
  it("matches the committed golden-report.json exactly", () => {
    const golden = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "fixtures", "golden-report.json"),
        "utf-8"
      )
    ) as BenchReport;

    expect(buildOfflineReport()).toEqual(golden);
  });
});

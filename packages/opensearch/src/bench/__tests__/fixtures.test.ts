import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadQueries } from "../fixtures.ts";

describe("loadQueries path handling", () => {
  it("loads the bundled fixture by bare filename", () => {
    expect(loadQueries().length).toBeGreaterThan(0);
  });

  it("loads from an explicit path without double-joining the fixtures dir", () => {
    // Regression: the live CLI / monitor passes a real path; it must not be
    // re-joined onto the bundled fixtures directory (which threw ENOENT before).
    const absolute = join(
      import.meta.dirname,
      "..",
      "fixtures",
      "queries.json"
    );
    expect(loadQueries(absolute)).toEqual(loadQueries());
  });
});

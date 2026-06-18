import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sharedSourceFileUrls = [
  new URL("../tool-factory.ts", import.meta.url),
  new URL("../tool-schemas.ts", import.meta.url),
] as const;
const runtimePackageImportPattern =
  /from\s+["']@minpeter\/opensearch(?:\/node)?["']/;

describe("OpenSearch AI SDK import boundary", () => {
  it("keeps shared factory and schema modules runtime-neutral", () => {
    const leakingFiles: string[] = [];

    for (const fileUrl of sharedSourceFileUrls) {
      const source = readFileSync(fileUrl, "utf8");

      if (runtimePackageImportPattern.test(source)) {
        leakingFiles.push(fileUrl.pathname);
      }
    }

    expect(leakingFiles).toStrictEqual([]);
  });
});

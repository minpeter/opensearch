import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = join(import.meta.dirname, "../../package.json");

function packageJson(): {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
} {
  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

describe("runtime package boundaries", () => {
  it("keeps TLS impersonation optional and Playwright dynamically loaded only", () => {
    const pkg = packageJson();

    expect(pkg.optionalDependencies?.["wreq-js"]).toBe("2.3.1");
    expect(pkg.dependencies).not.toHaveProperty("wreq-js");
    expect(pkg.dependencies).not.toHaveProperty("playwright");
    expect(pkg.optionalDependencies).not.toHaveProperty("playwright");
  });

  it("publishes only the root, node, and package metadata subpaths", () => {
    expect(Object.keys(packageJson().exports ?? {}).sort()).toEqual([
      ".",
      "./node",
      "./package.json",
    ]);
  });

  it("does not expose internal runtime helpers from public entrypoints", async () => {
    const rootApi = await import("../index.ts");
    const nodeApi = await import("../node.ts");

    for (const api of [rootApi, nodeApi]) {
      expect(api).not.toHaveProperty("fetchViaPlaywrightFallback");
      expect(api).not.toHaveProperty("fetchViaTlsImpersonation");
      expect(api).not.toHaveProperty("runAttemptPlan");
    }

    expect(rootApi).not.toHaveProperty("extractMediaMetadata");
    expect(nodeApi).toHaveProperty("extractMediaMetadata");
  });
});

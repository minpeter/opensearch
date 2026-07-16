export const PACKAGE_SPECS = [
  {
    directory: "packages/opensearch",
    imports: ["@minpeter/opensearch", "@minpeter/opensearch/node"],
    name: "@minpeter/opensearch",
  },
  {
    directory: "packages/opensearch-ai-sdk",
    imports: ["opensearch-ai-sdk", "opensearch-ai-sdk/node"],
    name: "opensearch-ai-sdk",
  },
  {
    binary: "opensearch-mcp",
    directory: "packages/opensearch-mcp",
    imports: [],
    name: "opensearch-mcp",
  },
];

export const retryOperation = async ({
  attempts,
  delayMs,
  onRetry,
  operation,
}) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts) {
        throw normalizedError;
      }
      await onRetry?.({ attempt, error: normalizedError });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("Retry operation received no attempts");
};

export const createSmokeTest = (packages) => `
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packages = ${JSON.stringify(packages)};

for (const packageSpec of packages) {
  const manifestPath = require.resolve(packageSpec.name + "/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.name, packageSpec.name);
  assert.equal(manifest.version, packageSpec.version);

  for (const dependencyGroup of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    for (const dependencyRange of Object.values(dependencyGroup ?? {})) {
      assert.equal(
        String(dependencyRange).startsWith("workspace:"),
        false,
        packageSpec.name + " contains an unpublished workspace protocol"
      );
    }
  }

  for (const importPath of packageSpec.imports) {
    const imported = await import(importPath);
    assert.ok(Object.keys(imported).length > 0, importPath + " exported nothing");
  }

  if (packageSpec.binary !== undefined) {
    const binaryPath = join(dirname(manifestPath), manifest.bin[packageSpec.binary]);
    await access(binaryPath);
    const source = await readFile(binaryPath, "utf8");
    assert.match(source, /^#!\\/usr\\/bin\\/env node/u);
  }
}

process.stdout.write("Package entrypoints passed clean-install smoke verification.\\n");
`;

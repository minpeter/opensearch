import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tegami } from "tegami";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const EXPECTED_PACKAGE_IDS = [
  "npm:@minpeter/opensearch",
  "npm:opensearch-ai-sdk",
  "npm:opensearch-mcp",
];

const readText = (path) => readFileSync(join(rootDir, path), "utf8");
const readJson = (path) => JSON.parse(readText(path));
const readDirectory = (path) => {
  const absolutePath = join(rootDir, path);
  return existsSync(absolutePath) ? readdirSync(absolutePath) : [];
};
const githubTokenExpression = [
  "GITHUB_TOKEN: $",
  "{{ secrets.GITHUB_TOKEN }}",
].join("");

test("root package.json uses Tegami release commands", () => {
  const manifest = readJson("package.json");

  assert.equal(manifest.scripts.tegami, "node scripts/tegami.mts");
  assert.equal(manifest.scripts.version, "pnpm tegami version");
  assert.ok(manifest.scripts.release.includes("pnpm tegami publish"));
  assert.equal(
    manifest.scripts["test:release"],
    "node --test scripts/tegami-config.test.mjs"
  );
  assert.equal(
    manifest.scripts["verify:published"],
    "node scripts/verify-published-packages.mjs"
  );
  assert.equal(
    manifest.scripts["verify:packed"],
    "node scripts/verify-packed-packages.mjs"
  );
  assert.deepEqual(manifest.workspaces, ["packages/*"]);
  assert.equal(manifest.scripts.changeset, undefined);
  assert.ok(manifest.devDependencies.tegami, "tegami must be installed");
  assert.equal(manifest.devDependencies["@changesets/cli"], undefined);
});

test("release workflow delegates versioning and publishing to Tegami", () => {
  const workflow = readText(".github/workflows/release.yml");

  assert.ok(workflow.includes("id-token: write"));
  assert.ok(workflow.includes(githubTokenExpression));
  assert.ok(workflow.includes("npm install -g npm@latest"));
  assert.ok(workflow.includes("pnpm run test:release"));
  assert.ok(workflow.includes("pnpm tegami ci"));
  assert.ok(workflow.includes("pnpm tegami check-publish"));
  assert.ok(workflow.includes("pnpm verify:published"));
  assert.ok(workflow.includes("if: steps.publish.outputs.needed == 'true'"));
  assert.ok(workflow.includes('NPM_CONFIG_PROVENANCE: "true"'));
  assert.equal(workflow.includes("changesets/action"), false);
  assert.equal(workflow.includes("pnpm changeset publish"), false);
});

test("CI runs the release-tooling regression test", () => {
  const workflow = readText(".github/workflows/ci.yml");

  assert.ok(workflow.includes("pnpm run test:release"));
});

test("Tegami entrypoint targets this repository", () => {
  const script = readText("scripts/tegami.mts");

  assert.ok(script.includes('from "tegami"'));
  assert.ok(script.includes('from "tegami/cli"'));
  assert.ok(script.includes('from "tegami/plugins/github"'));
  assert.ok(script.includes("createCli(paper).parseAsync()"));
  assert.ok(script.includes('client: "npm"'));
  assert.ok(script.includes("updateLockFile: false"));
  assert.ok(script.includes('name: "pnpm-lockfile"'));
  assert.ok(script.includes("applyCliDraft"));
  assert.ok(script.includes('"--lockfile-only"'));
  assert.ok(script.includes('repo: "minpeter/opensearch"'));
  assert.ok(script.includes('base: "main"'));
});

test("Tegami discovers workspace packages and resolves pending changelogs", async () => {
  const paper = tegami({
    cwd: rootDir,
    npm: {
      client: "npm",
      updateLockFile: false,
    },
  });
  const context = await paper._internal.context();
  const discoveredPackageIds = context.graph
    .getPackages()
    .map(({ id }) => id);

  for (const packageId of EXPECTED_PACKAGE_IDS) {
    assert.ok(
      discoveredPackageIds.includes(packageId),
      `Tegami did not discover ${packageId}`
    );
  }

  const pendingChangelogs = readDirectory(".tegami")
    .filter((fileName) => fileName.endsWith(".md"))
    .toSorted();
  if (pendingChangelogs.length === 0) {
    return;
  }

  const draft = await paper.draft();
  assert.equal(draft.hasPending(), true, "pending changelogs must bump packages");
  assert.deepEqual(
    draft
      .getChangelogs()
      .map(({ filename }) => filename)
      .toSorted(),
    pendingChangelogs,
    "every pending changelog must parse"
  );

  for (const changelog of draft.getChangelogs()) {
    for (const packageReference of changelog.packages.keys()) {
      assert.ok(
        context.graph.getByName(packageReference).length > 0,
        `${changelog.filename} references unknown package ${packageReference}`
      );
    }
  }
});

test("Changesets release metadata was removed", () => {
  const releaseMetadataFiles = readDirectory(".changeset").filter(
    (fileName) => fileName.endsWith(".md") || fileName === "config.json"
  );

  assert.deepEqual(releaseMetadataFiles, []);
});

test("published manifests contain no workspace dependency protocols", () => {
  const packageDirectories = [
    "packages/opensearch",
    "packages/opensearch-ai-sdk",
    "packages/opensearch-mcp",
  ];
  const dependencyFields = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ];

  for (const packageDirectory of packageDirectories) {
    const manifest = readJson(`${packageDirectory}/package.json`);
    for (const dependencyField of dependencyFields) {
      const dependencies = manifest[dependencyField] ?? {};
      for (const [dependencyName, dependencyRange] of Object.entries(
        dependencies
      )) {
        assert.equal(
          dependencyRange.startsWith("workspace:"),
          false,
          `${manifest.name} cannot publish ${dependencyName} as ${dependencyRange}`
        );
      }
    }
  }
});

test("README documents Tegami changelog package ids", () => {
  const readme = readText("README.md");

  assert.ok(readme.includes(".tegami/*.md"));
  assert.ok(readme.includes("npm:@minpeter/opensearch"));
  assert.ok(readme.includes("npm:opensearch-ai-sdk"));
  assert.ok(readme.includes("npm:opensearch-mcp"));
});

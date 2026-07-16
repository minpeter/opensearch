import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSmokeTest,
  PACKAGE_SPECS,
  retryOperation,
} from "./package-smoke.mjs";

const DEFAULT_ATTEMPTS = 30;
const DEFAULT_INSTALL_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;
const rootDirectory = fileURLToPath(new URL("..", import.meta.url));

const parsePositiveInteger = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const attempts = parsePositiveInteger(
  process.env.PUBLISHED_VERIFY_ATTEMPTS,
  DEFAULT_ATTEMPTS
);
const retryDelayMs = parsePositiveInteger(
  process.env.PUBLISHED_VERIFY_RETRY_MS,
  DEFAULT_RETRY_DELAY_MS
);
const installAttempts = parsePositiveInteger(
  process.env.PUBLISHED_VERIFY_INSTALL_ATTEMPTS,
  DEFAULT_INSTALL_ATTEMPTS
);
const registry = (
  process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org"
).replace(/\/$/u, "");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const delay = async (milliseconds) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const run = async (command, args, options = {}) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const outcome =
        signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${outcome}`));
    });
  });
};

const publishedMetadataUrl = (name) =>
  `${registry}/${encodeURIComponent(name)}`;

const waitForPublishedVersion = async ({ name, version }) => {
  let lastFailure = "not found";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(publishedMetadataUrl(name), {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        const metadata = await response.json();
        const publishedVersion = metadata.versions?.[version];
        if (
          publishedVersion?.version === version &&
          publishedVersion.dist?.integrity
        ) {
          process.stdout.write(`Registry contains ${name}@${version}.\n`);
          return;
        }
        lastFailure = "registry metadata was incomplete";
      } else {
        lastFailure = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      process.stdout.write(
        `Waiting for ${name}@${version} (${lastFailure}, attempt ${attempt}/${attempts})...\n`
      );
      await delay(retryDelayMs);
    }
  }

  throw new Error(
    `${name}@${version} did not become available from ${registry}: ${lastFailure}`
  );
};

const main = async () => {
  const packages = await Promise.all(
    PACKAGE_SPECS.map(async (packageSpec) => {
      const manifest = await readJson(
        join(rootDirectory, packageSpec.directory, "package.json")
      );
      return { ...packageSpec, version: manifest.version };
    })
  );

  await Promise.all(packages.map(waitForPublishedVersion));

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "opensearch-publish-")
  );
  try {
    await writeFile(
      join(temporaryDirectory, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
    );
    await writeFile(
      join(temporaryDirectory, "verify.mjs"),
      createSmokeTest(packages)
    );

    await retryOperation({
      attempts: installAttempts,
      delayMs: retryDelayMs,
      operation: async () => {
        await Promise.all([
          rm(join(temporaryDirectory, "node_modules"), {
            force: true,
            recursive: true,
          }),
          rm(join(temporaryDirectory, "package-lock.json"), { force: true }),
        ]);
        await run(
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--prefer-online",
            ...packages.map(({ name, version }) => `${name}@${version}`),
          ],
          { cwd: temporaryDirectory }
        );
      },
      onRetry: ({ attempt, error }) => {
        process.stdout.write(
          `Retrying clean registry install after attempt ${attempt}/${installAttempts}: ${error.message}\n`
        );
      },
    });
    await run("node", ["verify.mjs"], { cwd: temporaryDirectory });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
};

await main();

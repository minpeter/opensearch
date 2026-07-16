import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSmokeTest, PACKAGE_SPECS } from "./package-smoke.mjs";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

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

const runCapture = async (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      const outcome =
        signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${outcome}`));
    });
  });

const main = async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "opensearch-pack-"));
  const packedDirectory = join(temporaryDirectory, "tarballs");
  try {
    await mkdir(packedDirectory, { recursive: true });
    const packages = [];
    const tarballs = [];
    for (const packageSpec of PACKAGE_SPECS) {
      const manifest = await readJson(
        join(rootDirectory, packageSpec.directory, "package.json")
      );
      const output = await runCapture(
        "npm",
        [
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          packedDirectory,
          join(rootDirectory, packageSpec.directory),
        ],
        { cwd: rootDirectory }
      );
      const [packed] = JSON.parse(output);
      if (!(packed && typeof packed.filename === "string")) {
        throw new Error(`npm pack returned no tarball for ${packageSpec.name}`);
      }
      packages.push({ ...packageSpec, version: manifest.version });
      tarballs.push(join(packedDirectory, packed.filename));
    }

    const installDirectory = join(temporaryDirectory, "install");
    await mkdir(installDirectory, { recursive: true });
    await writeFile(
      join(installDirectory, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
    );
    await writeFile(
      join(installDirectory, "verify.mjs"),
      createSmokeTest(packages)
    );
    await run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs],
      { cwd: installDirectory }
    );
    await run("node", ["verify.mjs"], { cwd: installDirectory });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
};

await main();

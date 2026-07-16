#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const run = async (command: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
};

const pnpmLockfilePlugin = {
  name: "pnpm-lockfile",
  async applyCliDraft() {
    await run("pnpm", ["install", "--lockfile-only"]);
  },
};

const paper = tegami({
  npm: {
    client: "npm",
    updateLockFile: false,
  },
  plugins: [
    pnpmLockfilePlugin,
    github({
      repo: "minpeter/opensearch",
      versionPr: {
        base: "main",
      },
    }),
  ],
});

await createCli(paper).parseAsync();

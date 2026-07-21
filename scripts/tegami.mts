#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const pnpmLockfilePlugin = {
  async applyCliDraft() {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pnpm", ["install", "--lockfile-only"], {
        shell: process.platform === "win32",
        stdio: "inherit",
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`pnpm install --lockfile-only exited with ${code}`));
      });
    });
  },
  name: "pnpm-lockfile",
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

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const abortModuleUrl = new URL("../abort.ts", import.meta.url).href;
const packageDirectory = fileURLToPath(new URL("../..", import.meta.url));

describe("awaitAbortable", () => {
  it("observes a source rejection after a pre-aborted caller", async () => {
    // Given: a child process that fails if the source emits unhandledRejection.
    const script = `
      import { awaitAbortable } from ${JSON.stringify(abortModuleUrl)};
      const controller = new AbortController();
      controller.abort(new Error("caller aborted"));
      let rejectSource;
      const source = new Promise((_resolve, reject) => { rejectSource = reject; });
      process.once("unhandledRejection", () => { process.exitCode = 1; });

      // When: the pre-aborted wrapper rejects before its source later rejects.
      awaitAbortable(source, controller.signal).catch(() => undefined);
      rejectSource(new Error("late source failure"));

      // Then: two event-loop turns expose any unhandled source rejection.
      setImmediate(() => setImmediate(() => process.exit()));
    `;

    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", script],
      { cwd: packageDirectory, stdio: "ignore" }
    );

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });

    expect(exitCode).toBe(0);
  });
});

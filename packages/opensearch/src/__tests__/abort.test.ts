import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { awaitAbortable, withAbortSignal } from "../abort.ts";

const abortModuleUrl = new URL("../abort.ts", import.meta.url).href;
const packageDirectory = fileURLToPath(new URL("../..", import.meta.url));

describe("abort reason propagation", () => {
  it("preserves an explicit null reason through awaitAbortable", async () => {
    // Given: a caller signal aborted with an explicit null reason.
    const controller = new AbortController();
    controller.abort(null);

    // When: an unresolved operation is wrapped by that signal.
    const operation = awaitAbortable(
      new Promise<never>(() => undefined),
      controller.signal
    );

    // Then: null remains the rejection reason rather than becoming AbortError.
    await expect(operation).rejects.toBeNull();
  });

  it("preserves an explicit null reason through withAbortSignal", async () => {
    // Given: a caller signal aborted with an explicit null reason.
    const controller = new AbortController();
    controller.abort(null);

    // When: the composed operation observes its signal.
    const operation = withAbortSignal(controller.signal, 60_000, (signal) => {
      signal.throwIfAborted();
      return Promise.resolve();
    });

    // Then: null remains the rejection reason rather than becoming AbortError.
    await expect(operation).rejects.toBeNull();
  });

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

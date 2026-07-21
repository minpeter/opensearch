import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rm: vi.fn().mockRejectedValue(new Error("EPERM: cannot remove")),
  };
});

import { cleanupPlaywrightContext } from "../node/playwright-launch.ts";
import type { BrowserContext } from "../node/playwright-types.ts";

function contextWithClose(close: BrowserContext["close"]): BrowserContext {
  return { close, newPage: vi.fn(), route: vi.fn() };
}

describe("cleanupPlaywrightContext", () => {
  it("does not reject when temporary profile removal fails", async () => {
    const context = contextWithClose(vi.fn().mockResolvedValue(undefined));

    await expect(
      cleanupPlaywrightContext(context, "/tmp/opensearch-playwright-fake")
    ).resolves.toBeUndefined();
  });

  it("does not reject when the browser context close fails either", async () => {
    const context = contextWithClose(
      vi.fn().mockRejectedValue(new Error("browser already gone"))
    );

    await expect(
      cleanupPlaywrightContext(context, "/tmp/opensearch-playwright-fake")
    ).resolves.toBeUndefined();
  });
});

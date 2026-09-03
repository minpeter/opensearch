import { watch } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchViaPlaywrightFallback } from "../node/playwright-executor.ts";
import type {
  BrowserContext,
  Page,
  PlaywrightModule,
} from "../node/playwright-types.ts";

const page: Page = {
  content: () =>
    Promise.resolve('<main id="content">Loaded article content</main>'),
  goto: () => Promise.resolve(),
  waitForSelector: () => Promise.resolve(),
};

function profileRemoval(profile: string): {
  readonly close: () => void;
  readonly removed: Promise<void>;
} {
  const removed = Promise.withResolvers<void>();
  const watcher = watch(tmpdir(), (_event, filename) => {
    if (String(filename) !== basename(profile)) {
      return;
    }
    access(profile).catch(() => removed.resolve());
  });
  return { close: () => watcher.close(), removed: removed.promise };
}

describe("Playwright profile cleanup ordering", () => {
  it("awaits normal context close before removing the temporary profile", async () => {
    // Given
    const closeStarted = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    let profile = "";
    const close = vi.fn<BrowserContext["close"]>(async () => {
      await mkdir(profile, { recursive: true });
      await writeFile(`${profile}/browser-state`, "closed");
      closeStarted.resolve();
      await allowClose.promise;
    });
    const context: BrowserContext = {
      close,
      newPage: () => Promise.resolve(page),
      route: () => Promise.resolve(),
    };
    const launchPersistentContext = vi.fn<
      PlaywrightModule["chromium"]["launchPersistentContext"]
    >((profileDir) => {
      profile = profileDir;
      return Promise.resolve(context);
    });

    // When
    const fetching = fetchViaPlaywrightFallback("https://example.com/normal", {
      enabled: true,
      loader: () => Promise.resolve({ chromium: { launchPersistentContext } }),
    });
    await closeStarted.promise;
    const removal = profileRemoval(profile);
    allowClose.resolve();
    await fetching;
    await removal.removed;
    removal.close();

    // Then
    expect(close).toHaveBeenCalledOnce();
    await expect(access(profile)).rejects.toThrow();
  });

  it("awaits a late context close before removing the recreated temporary profile", async () => {
    // Given
    const controller = new AbortController();
    const reason = new Error("caller stopped launch");
    const launchStarted = Promise.withResolvers<void>();
    const launchResult = Promise.withResolvers<BrowserContext>();
    const closeStarted = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    let profile = "";
    const close = vi.fn<BrowserContext["close"]>(async () => {
      await mkdir(profile, { recursive: true });
      await writeFile(`${profile}/browser-state`, "closed");
      closeStarted.resolve();
      await allowClose.promise;
    });
    const newPage = vi.fn<BrowserContext["newPage"]>(() =>
      Promise.reject(new Error("page work started after abort"))
    );
    const context: BrowserContext = {
      close,
      newPage,
      route: () => Promise.resolve(),
    };
    const launchPersistentContext = vi.fn<
      PlaywrightModule["chromium"]["launchPersistentContext"]
    >((profileDir) => {
      profile = profileDir;
      launchStarted.resolve();
      return launchResult.promise;
    });
    const fetching = fetchViaPlaywrightFallback("https://example.com/late", {
      enabled: true,
      loader: () => Promise.resolve({ chromium: { launchPersistentContext } }),
      signal: controller.signal,
    });
    await launchStarted.promise;

    // When
    controller.abort(reason);
    await expect(fetching).rejects.toBe(reason);
    launchResult.resolve(context);
    await closeStarted.promise;
    const removal = profileRemoval(profile);
    allowClose.resolve();
    await removal.removed;
    removal.close();

    // Then
    expect(close).toHaveBeenCalledOnce();
    expect(newPage).not.toHaveBeenCalled();
    await expect(access(profile)).rejects.toThrow();
  });
});

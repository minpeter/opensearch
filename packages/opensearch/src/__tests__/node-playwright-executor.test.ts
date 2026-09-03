import { watch } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertSafeHttpUrl,
  NetworkPolicyError,
} from "../node/network-policy.ts";
import {
  fetchViaPlaywrightFallback,
  type PlaywrightLoader,
  playwrightFallbackEnabled,
} from "../node/playwright-executor.ts";
import { selectPlaywrightExecutor } from "../node/playwright-launch.ts";
import type {
  BrowserContext,
  PlaywrightModule,
} from "../node/playwright-types.ts";

interface FakePage {
  readonly content: ReturnType<typeof vi.fn>;
  readonly goto: ReturnType<typeof vi.fn>;
  readonly waitForSelector: ReturnType<typeof vi.fn>;
}

interface FakeContext {
  readonly close: ReturnType<typeof vi.fn>;
  readonly newPage: ReturnType<typeof vi.fn>;
  readonly route: ReturnType<typeof vi.fn>;
}

function createLoader(page: FakePage): {
  readonly context: FakeContext;
  readonly launchPersistentContext: ReturnType<typeof vi.fn>;
  readonly loader: PlaywrightLoader;
} {
  const context = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    route: vi.fn().mockResolvedValue(undefined),
  };
  const launchPersistentContext = vi.fn().mockResolvedValue(context);
  return {
    context,
    launchPersistentContext,
    loader: async () => ({
      chromium: { launchPersistentContext },
      devices: {
        "iPhone 13 Pro": {
          deviceScaleFactor: 3,
          isMobile: true,
          userAgent: "mobile-ua",
          viewport: { height: 844, width: 390 },
        },
      },
    }),
  };
}

function createPage(
  html = '<main id="content">Loaded article</main>'
): FakePage {
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
  };
}

describe("playwrightFallbackEnabled", () => {
  it("requires an explicit env opt-in", () => {
    expect(playwrightFallbackEnabled({})).toBe(false);
    expect(
      playwrightFallbackEnabled({
        OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK: "true",
      })
    ).toBe(true);
  });
});

describe("selectPlaywrightExecutor", () => {
  it("selects the real Chrome executor for TLS stack needs", () => {
    expect(
      selectPlaywrightExecutor({
        capabilities: ["needs_real_tls_stack"],
      })
    ).toBe("playwright_real_chrome");
  });

  it("selects MCP for plain JavaScript execution needs", () => {
    expect(
      selectPlaywrightExecutor({
        capabilities: ["needs_js_exec"],
      })
    ).toBe("playwright_mcp");
  });

  it("selects mobile Chrome for mobile context needs", () => {
    expect(
      selectPlaywrightExecutor({
        capabilities: ["needs_mobile_context", "needs_js_exec"],
      })
    ).toBe("playwright_mcp_mobile");
    expect(
      selectPlaywrightExecutor({
        capabilities: ["needs_mobile_context", "needs_real_tls_stack"],
      })
    ).toBe("playwright_mobile_chrome");
  });
});

describe("fetchViaPlaywrightFallback", () => {
  it("returns an unavailable trace when disabled", async () => {
    const result = await fetchViaPlaywrightFallback("https://example.com");

    expect(result.response).toBeUndefined();
    expect(result.trace[0]).toMatchObject({
      executor: "playwright",
      name: "playwright:playwright_real_chrome",
      verdict: "unknown",
    });
  });

  it("returns an unavailable trace when Playwright cannot load", async () => {
    const result = await fetchViaPlaywrightFallback("https://example.com", {
      enabled: true,
      loader: () => Promise.reject(new Error("missing playwright")),
    });

    expect(result.summary).toBe("missing playwright");
    expect(result.trace[0]?.summary).toBe("missing playwright");
  });

  it("returns a trace when Chrome is not installed", async () => {
    const launchPersistentContext = vi
      .fn()
      .mockRejectedValue(new Error("Chrome executable not found"));
    const result = await fetchViaPlaywrightFallback("https://example.com", {
      enabled: true,
      loader: async () => ({
        chromium: { launchPersistentContext },
      }),
    });

    expect(result.response).toBeUndefined();
    expect(result.summary).toBe("Chrome executable not found");
    expect(result.trace[0]).toMatchObject({
      name: "playwright:playwright_real_chrome",
      verdict: "unknown",
    });
  });

  it("launches real Chrome, waits for a selector, and revalidates HTML", async () => {
    const page = createPage();
    const { context, launchPersistentContext, loader } = createLoader(page);
    const result = await fetchViaPlaywrightFallback("https://example.com/a", {
      enabled: true,
      loader,
      profileDir: "/tmp/opensearch-test-profile",
      successSelectors: ["#content"],
      timeoutMs: 1234,
    });

    expect(result.response?.status).toBe(200);
    expect(launchPersistentContext).toHaveBeenCalledWith(
      "/tmp/opensearch-test-profile",
      expect.objectContaining({
        channel: "chrome",
        headless: false,
        timeout: 1234,
        viewport: { height: 900, width: 1440 },
      })
    );
    expect(page.goto).toHaveBeenCalledWith("https://example.com/a", {
      timeout: 1234,
      waitUntil: "domcontentloaded",
    });
    expect(page.waitForSelector).toHaveBeenCalledWith("#content", {
      state: "attached",
      timeout: 1234,
    });
    expect(context.close).toHaveBeenCalledOnce();
    expect(result.trace[0]).toMatchObject({
      bodySize: 40,
      name: "playwright:playwright_real_chrome",
      profileUsed: "playwright_real_chrome",
      verdict: "strong_ok",
    });
  });

  it("rejects with the caller reason when aborted before the loader resolves", async () => {
    const controller = new AbortController();
    const callerAbort = new Error("caller stopped Playwright loader");
    const loaderStarted = Promise.withResolvers<void>();
    const loaderResult = Promise.withResolvers<PlaywrightModule>();
    const launchPersistentContext =
      vi.fn<PlaywrightModule["chromium"]["launchPersistentContext"]>();
    const page = createPage();

    const fetching = fetchViaPlaywrightFallback("https://example.com/a", {
      enabled: true,
      loader: () => {
        loaderStarted.resolve();
        return loaderResult.promise;
      },
      signal: controller.signal,
    });
    await loaderStarted.promise;
    controller.abort(callerAbort);

    await expect(fetching).rejects.toBe(callerAbort);
    loaderResult.resolve({ chromium: { launchPersistentContext } });
    await Promise.resolve();
    expect(launchPersistentContext).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("cleans a late browser context and profile once without starting page work", async () => {
    const controller = new AbortController();
    const callerAbort = new Error("caller stopped Playwright launch");
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
    const context: BrowserContext = {
      close,
      newPage: vi.fn<BrowserContext["newPage"]>(() =>
        Promise.reject(new Error("post-abort page work started"))
      ),
      route: vi.fn<BrowserContext["route"]>(() => Promise.resolve()),
    };
    const launchPersistentContext = vi.fn<
      PlaywrightModule["chromium"]["launchPersistentContext"]
    >(() => {
      launchStarted.resolve();
      return launchResult.promise;
    });
    const loader: PlaywrightLoader = async () => ({
      chromium: { launchPersistentContext },
    });

    const fetching = fetchViaPlaywrightFallback("https://example.com/a", {
      enabled: true,
      loader,
      signal: controller.signal,
    });
    await launchStarted.promise;
    profile = String(launchPersistentContext.mock.calls[0]?.[0]);
    controller.abort(callerAbort);

    await expect(fetching).rejects.toBe(callerAbort);
    launchResult.resolve(context);
    await closeStarted.promise;
    const profileRemoved = Promise.withResolvers<void>();
    const watcher = watch(tmpdir(), (_event, filename) => {
      if (String(filename) !== basename(profile)) {
        return;
      }
      access(profile).catch(() => profileRemoved.resolve());
    });
    allowClose.resolve();
    await profileRemoved.promise;
    watcher.close();
    expect(close).toHaveBeenCalledOnce();
    expect(context.newPage).not.toHaveBeenCalled();
    await expect(access(profile)).rejects.toThrow();
  });

  it("closes the browser context once when the caller aborts navigation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    const navigationStarted = Promise.withResolvers<void>();
    const page = createPage();
    page.goto.mockImplementation(() => {
      navigationStarted.resolve();
      return new Promise(() => undefined);
    });
    const { context, loader } = createLoader(page);

    const fetching = fetchViaPlaywrightFallback("https://example.com/a", {
      enabled: true,
      loader,
      profileDir: "/tmp/opensearch-test-profile",
      signal: controller.signal,
    });
    await navigationStarted.promise;
    controller.abort(reason);

    await expect(fetching).rejects.toBe(reason);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("uses isolated temporary profiles and removes them after each call", async () => {
    const first = createLoader(createPage());
    const second = createLoader(createPage());

    await Promise.all([
      fetchViaPlaywrightFallback("https://example.com/one", {
        enabled: true,
        loader: first.loader,
      }),
      fetchViaPlaywrightFallback("https://example.com/two", {
        enabled: true,
        loader: second.loader,
      }),
    ]);

    const firstProfile = String(
      first.launchPersistentContext.mock.calls[0]?.[0]
    );
    const secondProfile = String(
      second.launchPersistentContext.mock.calls[0]?.[0]
    );
    expect(firstProfile).not.toBe(secondProfile);
    await expect(access(firstProfile)).rejects.toThrow();
    await expect(access(secondProfile)).rejects.toThrow();
  });

  it("applies the configured mobile device profile", async () => {
    const page = createPage();
    const { launchPersistentContext, loader } = createLoader(page);
    const result = await fetchViaPlaywrightFallback("https://example.com/m", {
      deviceClass: "mobile",
      enabled: true,
      loader,
    });

    expect(result.response?.status).toBe(200);
    expect(launchPersistentContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        channel: "chrome",
        isMobile: true,
        userAgent: "mobile-ua",
        viewport: { height: 844, width: 390 },
      })
    );
    expect(result.trace[0]?.name).toBe("playwright:playwright_mobile_chrome");
  });

  it("rejects rendered HTML over the byte limit", async () => {
    const page = createPage("x".repeat(65));
    const { loader } = createLoader(page);

    await expect(
      fetchViaPlaywrightFallback("https://example.com/large", {
        enabled: true,
        loader,
        maxResponseBytes: 64,
      })
    ).rejects.toThrow("64-byte download limit");
  });

  it("blocks private redirect and subresource requests", async () => {
    const page = createPage();
    const { context, loader } = createLoader(page);
    const abort = vi.fn().mockResolvedValue(undefined);
    const continueRequest = vi.fn().mockResolvedValue(undefined);
    context.route.mockImplementation(async (_pattern, handler) => {
      await handler(
        { abort, continue: continueRequest },
        { url: () => "http://127.0.0.1/private" }
      );
    });

    await expect(
      fetchViaPlaywrightFallback("https://example.com/start", {
        abortOnError: (error) => error instanceof NetworkPolicyError,
        enabled: true,
        loader,
        validateUrl: (url) => {
          assertSafeHttpUrl(url);
        },
      })
    ).rejects.toBeInstanceOf(NetworkPolicyError);

    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(continueRequest).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("preserves a policy error when a blocked navigation rejects goto", async () => {
    const page = createPage();
    page.goto.mockRejectedValue(new Error("navigation aborted"));
    const { context, loader } = createLoader(page);
    context.route.mockImplementation(async (_pattern, handler) => {
      await handler(
        {
          abort: vi.fn().mockResolvedValue(undefined),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        { url: () => "http://127.0.0.1/private" }
      );
    });

    await expect(
      fetchViaPlaywrightFallback("https://example.com/start", {
        abortOnError: (error) => error instanceof NetworkPolicyError,
        enabled: true,
        loader,
        validateUrl: (url) => {
          assertSafeHttpUrl(url);
        },
      })
    ).rejects.toBeInstanceOf(NetworkPolicyError);
  });

  it("allows non-network data and blob subresources", async () => {
    const page = createPage();
    const { context, loader } = createLoader(page);
    const abort = vi.fn().mockResolvedValue(undefined);
    const continueRequest = vi.fn().mockResolvedValue(undefined);
    context.route.mockImplementation(async (_pattern, handler) => {
      for (const url of [
        "data:text/plain,hello",
        "blob:https://example.com/id",
      ]) {
        // biome-ignore lint/performance/noAwaitInLoops: intentional sequential test execution
        await handler({ abort, continue: continueRequest }, { url: () => url });
      }
    });

    const result = await fetchViaPlaywrightFallback("https://example.com", {
      enabled: true,
      loader,
      validateUrl: (url) => {
        assertSafeHttpUrl(url);
      },
    });

    expect(result.response?.status).toBe(200);
    expect(continueRequest).toHaveBeenCalledTimes(2);
    expect(abort).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  fetchViaPlaywrightFallback,
  type PlaywrightLoader,
  playwrightFallbackEnabled,
  selectPlaywrightExecutor,
} from "../node/playwright-executor.ts";

interface FakePage {
  readonly content: ReturnType<typeof vi.fn>;
  readonly goto: ReturnType<typeof vi.fn>;
  readonly waitForSelector: ReturnType<typeof vi.fn>;
}

interface FakeContext {
  readonly close: ReturnType<typeof vi.fn>;
  readonly newPage: ReturnType<typeof vi.fn>;
}

function createLoader(page: FakePage): {
  readonly context: FakeContext;
  readonly launchPersistentContext: ReturnType<typeof vi.fn>;
  readonly loader: PlaywrightLoader;
} {
  const context = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
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
});

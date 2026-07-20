import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BrowserContext,
  PlaywrightExecutorName,
  PlaywrightFallbackOptions,
  PlaywrightLaunchOptions,
  PlaywrightModule,
} from "./playwright-types.ts";

export const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_DEVICE_NAME = "iPhone 13 Pro";

export function selectPlaywrightExecutor(
  options: Pick<PlaywrightFallbackOptions, "capabilities" | "deviceClass"> = {}
): PlaywrightExecutorName {
  const capabilities = new Set(options.capabilities ?? []);
  const mobile =
    options.deviceClass === "mobile" ||
    capabilities.has("needs_mobile_context");
  if (mobile) {
    return capabilities.has("needs_js_exec") &&
      !capabilities.has("needs_real_tls_stack")
      ? "playwright_mcp_mobile"
      : "playwright_mobile_chrome";
  }
  if (capabilities.has("needs_real_tls_stack")) {
    return "playwright_real_chrome";
  }
  return capabilities.has("needs_js_exec")
    ? "playwright_mcp"
    : "playwright_real_chrome";
}

export function buildLaunchOptions(
  playwright: PlaywrightModule,
  executor: PlaywrightExecutorName,
  options: PlaywrightFallbackOptions
): PlaywrightLaunchOptions {
  const base = {
    channel: "chrome" as const,
    headless: options.headless ?? false,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  if (executor !== "playwright_mobile_chrome") {
    return { ...base, viewport: { height: 900, width: 1440 } };
  }
  const deviceName = options.deviceName ?? DEFAULT_DEVICE_NAME;
  const device = playwright.devices?.[deviceName];
  if (!device) {
    throw new Error(`Playwright device unavailable: ${deviceName}`);
  }
  return { ...base, ...device };
}

export async function preparePlaywrightProfile(profileDir?: string): Promise<{
  readonly path: string;
  readonly temporaryPath?: string;
}> {
  if (profileDir) {
    return { path: profileDir };
  }
  const temporaryPath = await mkdtemp(join(tmpdir(), "opensearch-playwright-"));
  return { path: temporaryPath, temporaryPath };
}

export async function cleanupPlaywrightContext(
  context: BrowserContext | undefined,
  temporaryProfileDir: string | undefined
): Promise<void> {
  try {
    await context?.close();
  } finally {
    if (temporaryProfileDir) {
      await rm(temporaryProfileDir, { force: true, recursive: true });
    }
  }
}

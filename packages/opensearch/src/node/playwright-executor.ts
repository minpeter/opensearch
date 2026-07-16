import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateChallenge } from "../fetch/challenge.ts";
import { DEFAULT_MAX_DOWNLOAD_BYTES } from "../fetch/local-options.ts";
import type { FetchAttemptTrace, FetchVerdict } from "../fetch/result.ts";
import {
  assertTextByteLimit,
  ResponseSizeLimitError,
} from "../response-body.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_DEVICE_NAME = "iPhone 13 Pro";
const OK_VERDICTS = new Set<FetchVerdict>(["strong_ok", "weak_ok"]);
const PLAYWRIGHT_ENV = "OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK";
const PLAYWRIGHT_PACKAGE = "playwright";
const NON_NETWORK_BROWSER_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

export type PlaywrightDeviceClass = "auto" | "desktop" | "mobile";
export type PlaywrightExecutorName =
  | "playwright_mcp"
  | "playwright_mcp_mobile"
  | "playwright_mobile_chrome"
  | "playwright_real_chrome";

export interface PlaywrightFallbackOptions {
  readonly abortOnError?: (error: unknown) => boolean;
  readonly capabilities?: readonly string[];
  readonly deviceClass?: PlaywrightDeviceClass;
  readonly deviceName?: string;
  readonly enabled?: boolean;
  readonly headless?: boolean;
  readonly loader?: PlaywrightLoader;
  readonly maxResponseBytes?: number;
  readonly profileDir?: string;
  readonly successSelectors?: readonly string[];
  readonly timeoutMs?: number;
  readonly validateUrl?: (url: string) => void;
  readonly waitSelector?: string;
}

export interface PlaywrightFallbackResult {
  readonly response?: Response;
  readonly summary?: string;
  readonly trace: readonly FetchAttemptTrace[];
  readonly verdict: FetchVerdict;
}

interface BrowserContext {
  close(): Promise<void>;
  newPage(): Promise<Page>;
  route(
    url: string,
    handler: (route: Route, request: Request) => Promise<void>
  ): Promise<void>;
}

interface Request {
  url(): string;
}

interface Route {
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserDevice {
  readonly [key: string]: unknown;
}

interface Page {
  content(): Promise<string>;
  goto(url: string, options: PageGotoOptions): Promise<unknown>;
  waitForSelector(selector: string, options: WaitOptions): Promise<unknown>;
}

interface PageGotoOptions {
  readonly timeout: number;
  readonly waitUntil: "domcontentloaded";
}

interface PlaywrightModule {
  readonly chromium: {
    launchPersistentContext(
      profileDir: string,
      options: PlaywrightLaunchOptions
    ): Promise<BrowserContext>;
  };
  readonly devices?: Readonly<Record<string, BrowserDevice>>;
}

interface PlaywrightLaunchOptions {
  readonly channel: "chrome";
  readonly headless: boolean;
  readonly timeout: number;
  readonly viewport?: { readonly height: number; readonly width: number };
  readonly [key: string]: unknown;
}

interface WaitOptions {
  readonly state: "attached";
  readonly timeout: number;
}

export type PlaywrightLoader = () => Promise<PlaywrightModule>;

export function playwrightFallbackEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[PLAYWRIGHT_ENV] === "true";
}

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

export async function fetchViaPlaywrightFallback(
  url: string,
  options: PlaywrightFallbackOptions = {}
): Promise<PlaywrightFallbackResult> {
  if (!(options.enabled ?? playwrightFallbackEnabled())) {
    return unavailableTrace(url, "playwright fallback disabled");
  }

  const executor = selectPlaywrightExecutor(options);
  if (executor.startsWith("playwright_mcp")) {
    return unavailableTrace(
      url,
      "playwright mcp requires caller session",
      executor
    );
  }

  const startedAt = Date.now();
  let context: BrowserContext | undefined;
  let blockedRequestError: unknown;
  let temporaryProfileDir: string | undefined;
  try {
    options.validateUrl?.(url);
    const playwright = await (options.loader ?? defaultPlaywrightLoader)();
    const launchOptions = buildLaunchOptions(playwright, executor, options);
    const profile = await preparePlaywrightProfile(options.profileDir);
    temporaryProfileDir = profile.temporaryPath;
    context = await playwright.chromium.launchPersistentContext(
      profile.path,
      launchOptions
    );
    if (options.validateUrl) {
      await context.route("**/*", async (route, request) => {
        try {
          const requestUrl = request.url();
          if (isNetworkBrowserRequest(requestUrl)) {
            options.validateUrl?.(requestUrl);
          }
          await route.continue();
        } catch (error) {
          blockedRequestError = error;
          await route.abort("blockedbyclient");
        }
      });
    }
    const page = await context.newPage();
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
    if (blockedRequestError) {
      throw blockedRequestError;
    }
    const selector = options.waitSelector ?? options.successSelectors?.[0];
    if (selector) {
      await page.waitForSelector(selector, { state: "attached", timeout });
    }
    const body = await page.content();
    assertTextByteLimit(
      body,
      options.maxResponseBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
    );
    const validation = validateChallenge({
      body,
      status: 200,
      successSelectors: options.successSelectors,
      tinyBodyIsChallenge: false,
    });
    const trace = playwrightTrace(url, executor, validation.verdict, {
      bodySize: validation.bodySize,
      elapsedMs: Date.now() - startedAt,
      reasons: validation.reasons,
      status: validation.status,
      summary: validation.reasons.join(", ") || undefined,
    });
    return OK_VERDICTS.has(validation.verdict)
      ? {
          response: new Response(body, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
            status: 200,
          }),
          trace: [trace],
          verdict: validation.verdict,
        }
      : { summary: trace.summary, trace: [trace], verdict: validation.verdict };
  } catch (error) {
    const effectiveError = blockedRequestError ?? error;
    if (
      effectiveError instanceof ResponseSizeLimitError ||
      options.abortOnError?.(effectiveError)
    ) {
      throw effectiveError;
    }
    const summary = errorMessage(effectiveError);
    return {
      summary,
      trace: [
        playwrightTrace(url, executor, "unknown", {
          elapsedMs: Date.now() - startedAt,
          summary,
        }),
      ],
      verdict: "unknown",
    };
  } finally {
    await cleanupPlaywrightContext(context, temporaryProfileDir);
  }
}

async function preparePlaywrightProfile(profileDir?: string): Promise<{
  readonly path: string;
  readonly temporaryPath?: string;
}> {
  if (profileDir) {
    return { path: profileDir };
  }
  const temporaryPath = await mkdtemp(join(tmpdir(), "opensearch-playwright-"));
  return { path: temporaryPath, temporaryPath };
}

async function cleanupPlaywrightContext(
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

function isNetworkBrowserRequest(rawUrl: string): boolean {
  try {
    return !NON_NETWORK_BROWSER_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return true;
  }
}

function buildLaunchOptions(
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

function defaultPlaywrightLoader(): Promise<PlaywrightModule> {
  return import(PLAYWRIGHT_PACKAGE) as Promise<PlaywrightModule>;
}

function unavailableTrace(
  url: string,
  summary: string,
  executor: PlaywrightExecutorName = "playwright_real_chrome"
): PlaywrightFallbackResult {
  return {
    summary,
    trace: [playwrightTrace(url, executor, "unknown", { summary })],
    verdict: "unknown",
  };
}

function playwrightTrace(
  url: string,
  executor: PlaywrightExecutorName,
  verdict: FetchVerdict,
  values: Omit<FetchAttemptTrace, "executor" | "name" | "phase" | "url">
): FetchAttemptTrace {
  return {
    ...values,
    executor: "playwright",
    name: `playwright:${executor}`,
    phase: "fallback",
    profileUsed: executor,
    url,
    verdict,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "playwright unavailable";
}

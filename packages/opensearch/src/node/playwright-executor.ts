import { validateChallenge } from "../fetch/challenge.ts";
import { DEFAULT_MAX_DOWNLOAD_BYTES } from "../fetch/local-options.ts";
import type { FetchAttemptTrace, FetchVerdict } from "../fetch/result.ts";
import {
  assertTextByteLimit,
  ResponseSizeLimitError,
} from "../response-body.ts";
import {
  buildLaunchOptions,
  cleanupPlaywrightContext,
  DEFAULT_TIMEOUT_MS,
  preparePlaywrightProfile,
  selectPlaywrightExecutor,
} from "./playwright-launch.ts";
import {
  type BrowserContext,
  defaultPlaywrightLoader,
  type PlaywrightExecutorName,
  type PlaywrightFallbackOptions,
  type PlaywrightFallbackResult,
} from "./playwright-types.ts";

export type {
  PlaywrightDeviceClass,
  PlaywrightExecutorName,
  PlaywrightFallbackOptions,
  PlaywrightFallbackResult,
  PlaywrightLoader,
} from "./playwright-types.ts";

const PLAYWRIGHT_ENV = "OPENSEARCH_ENABLE_PLAYWRIGHT_FALLBACK";
const OK_VERDICTS = new Set<FetchVerdict>(["strong_ok", "weak_ok"]);
const NON_NETWORK_BROWSER_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

export function playwrightFallbackEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[PLAYWRIGHT_ENV] === "true";
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

function isNetworkBrowserRequest(rawUrl: string): boolean {
  try {
    return !NON_NETWORK_BROWSER_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return true;
  }
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

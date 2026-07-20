import type { FetchAttemptTrace, FetchVerdict } from "../fetch/result.ts";

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

export interface BrowserContext {
  close: () => Promise<void>;
  newPage: () => Promise<Page>;
  route: (
    url: string,
    handler: (route: Route, request: Request) => Promise<void>
  ) => Promise<void>;
}

export interface Request {
  url: () => string;
}

export interface Route {
  abort: (errorCode?: string) => Promise<void>;
  continue: () => Promise<void>;
}

export interface BrowserDevice {
  readonly [key: string]: unknown;
}

export interface Page {
  content: () => Promise<string>;
  goto: (url: string, options: PageGotoOptions) => Promise<unknown>;
  waitForSelector: (selector: string, options: WaitOptions) => Promise<unknown>;
}

export interface PageGotoOptions {
  readonly timeout: number;
  readonly waitUntil: "domcontentloaded";
}

export interface PlaywrightModule {
  readonly chromium: {
    launchPersistentContext: (
      profileDir: string,
      options: PlaywrightLaunchOptions
    ) => Promise<BrowserContext>;
  };
  readonly devices?: Readonly<Record<string, BrowserDevice>>;
}

export interface PlaywrightLaunchOptions {
  readonly channel: "chrome";
  readonly headless: boolean;
  readonly timeout: number;
  readonly viewport?: { readonly height: number; readonly width: number };
  readonly [key: string]: unknown;
}

export interface WaitOptions {
  readonly state: "attached";
  readonly timeout: number;
}

export type PlaywrightLoader = () => Promise<PlaywrightModule>;

const PLAYWRIGHT_PACKAGE = "playwright";

export function defaultPlaywrightLoader(): Promise<PlaywrightModule> {
  return import(PLAYWRIGHT_PACKAGE) as Promise<PlaywrightModule>;
}

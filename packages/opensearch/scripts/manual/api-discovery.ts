import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ApiDiscoveryRequest,
  buildApiDiscoveryReport,
} from "../../src/fetch/api-discovery.ts";

const OUTPUT_PATH =
  ".omo/ulw-loop/evidence/opensearch-insane-search-parity/manual-qa/playwright-api-discovery.json";
const PLAYWRIGHT_PACKAGE = "playwright";

interface BrowserContext {
  close: () => Promise<void>;
  newPage: () => Promise<Page>;
}

interface Page {
  goto: (
    url: string,
    options: { readonly timeout: number }
  ) => Promise<unknown>;
  on: (
    event: "request",
    listener: (request: PlaywrightRequest) => void
  ) => void;
  waitForTimeout: (timeoutMs: number) => Promise<void>;
}

interface PlaywrightModule {
  readonly chromium: {
    launchPersistentContext: (
      profileDir: string,
      options: {
        readonly channel: "chrome";
        readonly headless: boolean;
        readonly timeout: number;
      }
    ) => Promise<BrowserContext>;
  };
}

interface PlaywrightRequest {
  method: () => string;
  resourceType: () => string;
  url: () => string;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function recordedRequests(): readonly ApiDiscoveryRequest[] {
  return [
    {
      method: "GET",
      resourceType: "document",
      status: 200,
      url: "https://example.com/products",
    },
    {
      method: "GET",
      resourceType: "xhr",
      status: 200,
      url: "https://example.com/api/products?token=secret&page=1",
    },
    {
      method: "POST",
      resourceType: "fetch",
      status: 200,
      url: "https://example.com/graphql?session=abc",
    },
    {
      method: "GET",
      resourceType: "script",
      status: 200,
      url: "https://example.com/data/catalog.json",
    },
  ];
}

async function liveRequests(
  url: string
): Promise<readonly ApiDiscoveryRequest[]> {
  const playwright = (await import(PLAYWRIGHT_PACKAGE)) as PlaywrightModule;
  const context = await playwright.chromium.launchPersistentContext(
    "/tmp/opensearch-api-discovery-profile",
    { channel: "chrome", headless: false, timeout: 20_000 }
  );
  const requests: ApiDiscoveryRequest[] = [];
  try {
    const page = await context.newPage();
    page.on("request", (request) => {
      requests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
    });
    await page.goto(url, { timeout: 20_000 });
    await page.waitForTimeout(3000);
    return requests;
  } finally {
    await context.close();
  }
}

async function requestsForTarget(
  targetUrl: string
): Promise<readonly ApiDiscoveryRequest[]> {
  if (process.argv.includes("--live")) {
    try {
      return await liveRequests(targetUrl);
    } catch (error) {
      return [
        {
          method: "GET",
          resourceType: "unavailable",
          url: `playwright-unavailable:${error instanceof Error ? error.message : "unknown"}`,
        },
      ];
    }
  }
  return recordedRequests();
}

async function run(): Promise<void> {
  const targetUrl = argValue("--url") ?? "https://example.com/products";
  const requests = await requestsForTarget(targetUrl);
  const report = buildApiDiscoveryReport({ requests, targetUrl });
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

await run();

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createFetchToolResult } from "../../../opensearch-mcp/src/tool-io.ts";
import {
  ampCacheUrl,
  archiveTodayUrls,
  waybackAvailabilityUrl,
} from "../../src/fetch/cache-archive.ts";
import { discoverFeedCandidates, parseFeed } from "../../src/fetch/feed.ts";
import { fetchJinaReader } from "../../src/fetch/jina.ts";
import type { FetchResult } from "../../src/fetch/result.ts";
import { extractMediaMetadata } from "../../src/node/media.ts";

const EVIDENCE_DIR =
  ".omo/ulw-loop/evidence/opensearch-insane-search-parity/manual-qa";
const PHASE1_OUTPUT = `${EVIDENCE_DIR}/phase1-fallback-live.jsonl`;
const MCP_OUTPUT = `${EVIDENCE_DIR}/mcp-fetch-output.txt`;
const COMMANDS_LOG = `${EVIDENCE_DIR}/commands.log`;
const SUMMARY_OUTPUT = `${EVIDENCE_DIR}/t21-summary.json`;
const COMMAND =
  "node --experimental-strip-types packages/opensearch/scripts/manual/parity-qa-matrix.ts";
const SENSITIVE_ENV_NAMES = [
  "EXA_API_KEY",
  "TINYFISH_API_KEY",
  "FIRECRAWL_API_KEY",
  "PARALLEL_API_KEY",
] as const;

interface QaRecord {
  readonly expected: "happy" | "failure" | "unavailable";
  readonly group: string;
  readonly name: string;
  readonly ok: boolean;
  readonly profileUsed?: string | null;
  readonly source?: string | null;
  readonly summary?: string | null;
  readonly verdict?: string | null;
}

function fetchResultRecord(
  name: string,
  group: string,
  expected: QaRecord["expected"],
  result: FetchResult | null
): QaRecord {
  return {
    expected,
    group,
    name,
    ok: result !== null,
    profileUsed: result?.profileUsed ?? null,
    source: result?.source ?? null,
    summary: result?.summary ?? null,
    verdict: result?.verdict ?? null,
  };
}

function installRecordedJinaFetch(): typeof fetch {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input) => {
    const url = String(input);
    if (url === "https://r.jina.ai/https://example.com/article") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              content: "# Recorded article\n\nReadable article body.",
              external: {
                alternate: {
                  rss: { url: "https://example.com/feed.xml" },
                },
              },
              title: "Recorded article",
              url: "https://example.com/article",
            },
          }),
          { status: 200 }
        )
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;
  return originalFetch;
}

async function runJinaScenario(): Promise<QaRecord> {
  const originalFetch = installRecordedJinaFetch();
  try {
    const result = await fetchJinaReader("https://example.com/article", {
      mode: "json",
      noCache: true,
      targetSelector: "article",
      withLinks: true,
    });
    return {
      expected: "happy",
      group: "jina",
      name: "jina-json-selector-alternate-recorded",
      ok:
        result?.mode === "json" &&
        result.alternates.includes("https://example.com/feed.xml"),
      profileUsed: "jina:json",
      source: "jina",
      verdict: result ? "strong_ok" : null,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runMediaScenarios(): Promise<readonly QaRecord[]> {
  const happy = await extractMediaMetadata("https://video.example/watch?v=1", {
    runner: async () => ({
      stdout: JSON.stringify({
        description: "Recorded media description",
        duration: 123,
        extractor: "recorded",
        tags: ["manual-qa"],
        title: "Recorded media",
        uploader: "OpenSearch QA",
        view_count: 42,
        webpage_url: "https://video.example/watch?v=1",
      }),
    }),
  });
  const missing = await extractMediaMetadata("https://video.example/missing", {
    runner: () =>
      Promise.reject(
        Object.assign(new Error("yt-dlp missing"), { code: "ENOENT" })
      ),
  });

  return [
    fetchResultRecord("media-yt-dlp-recorded", "media", "happy", happy),
    fetchResultRecord(
      "media-yt-dlp-unavailable-recorded",
      "media",
      "unavailable",
      missing
    ),
  ];
}

function runFeedScenarios(): readonly QaRecord[] {
  const feed = parseFeed(
    "https://example.com/feed.xml",
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Recorded Feed</title><item><title>Recorded Feed Item</title><link>https://example.com/item</link><description>Recorded summary</description></item></channel></rss>`
  );
  const candidates = discoverFeedCandidates("https://example.com/article", {
    html: `<link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">`,
  });
  const candidateUrls = candidates.map((candidate) => candidate.url);

  return [
    fetchResultRecord("feed-rss-parse-recorded", "feed", "happy", feed),
    {
      expected: "happy",
      group: "feed",
      name: "feed-discovery-recorded",
      ok:
        candidateUrls.includes("https://example.com/feed.xml") &&
        candidateUrls.includes("https://example.com/atom.xml"),
      profileUsed: "feed:auto-discovery",
      source: "feed",
      verdict: "strong_ok",
    },
  ];
}

function runArchiveScenario(): QaRecord {
  const targetUrl = "https://www.example.com/article";
  const candidates = [
    ampCacheUrl(targetUrl),
    ...archiveTodayUrls(targetUrl),
    waybackAvailabilityUrl(targetUrl),
  ];
  return {
    expected: "happy",
    group: "archive",
    name: "archive-sidecar-candidates-recorded",
    ok:
      candidates.some((url) => url.includes("cdn.ampproject.org")) &&
      candidates.some((url) => url.includes("archive.ph/newest")) &&
      candidates.some((url) => url.includes("archive.org/wayback")),
    profileUsed: "archive:sidecar",
    source: "archive",
    verdict: "strong_ok",
  };
}

function writeMcpOutput(): void {
  const result: FetchResult = {
    content: "# Recorded MCP fetch\n\nReadable content from QA fixture.",
    length: 52,
    profileUsed: "manual:recorded",
    source: "manual-qa",
    summary: "Recorded MCP fetch output for parity QA",
    title: "Recorded MCP fetch",
    url: "https://example.com/mcp",
    verdict: "strong_ok",
  };
  const toolResult = createFetchToolResult(result);
  const text = toolResult.content.map((item) => item.text).join("\n\n");
  writeFileSync(MCP_OUTPUT, `${text}\n`);
}

function appendCommandLog(records: readonly QaRecord[]): void {
  const redactedEnv = Object.fromEntries(
    SENSITIVE_ENV_NAMES.map((name) => [
      name,
      process.env[name] ? "[set]" : "[unset]",
    ])
  );
  const entry = {
    artifactCount: records.length + 2,
    command: COMMAND,
    env: redactedEnv,
    node: process.version,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(COMMANDS_LOG, `${JSON.stringify(entry)}\n`);
}

async function run(): Promise<void> {
  mkdirSync(dirname(PHASE1_OUTPUT), { recursive: true });
  const records = [
    ...runFeedScenarios(),
    await runJinaScenario(),
    runArchiveScenario(),
    ...(await runMediaScenarios()),
  ];
  writeFileSync(
    PHASE1_OUTPUT,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
  writeMcpOutput();
  appendCommandLog(records);
  writeFileSync(
    SUMMARY_OUTPUT,
    `${JSON.stringify({
      artifacts: [PHASE1_OUTPUT, MCP_OUTPUT, COMMANDS_LOG],
      ok: records.every((record) => record.ok),
      records: records.length,
      timestamp: new Date().toISOString(),
    })}\n`
  );
}

await run();

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchViaPublicApi } from "../../src/fetch/public-api.ts";

const OUTPUT_PATH =
  ".omo/ulw-loop/evidence/opensearch-insane-search-parity/manual-qa/public-api-live.jsonl";

interface Scenario {
  readonly expected: "happy" | "fallback";
  readonly group: string;
  readonly name: string;
  readonly url: string;
}

interface QaRecord {
  readonly contentLength: number;
  readonly expected: Scenario["expected"];
  readonly group: string;
  readonly name: string;
  readonly ok: boolean;
  readonly profileUsed: string | null;
  readonly title: string | null;
  readonly url: string;
  readonly verdict: string | null;
}

const scenarios: readonly Scenario[] = [
  {
    expected: "happy",
    group: "reddit-hn",
    name: "reddit-hot-recorded",
    url: "https://www.reddit.com/r/typescript/hot/",
  },
  {
    expected: "fallback",
    group: "reddit-hn",
    name: "hn-error-recorded",
    url: "https://news.ycombinator.com/item?id=404",
  },
  {
    expected: "happy",
    group: "social",
    name: "x-oembed-recorded",
    url: "https://x.com/opensearch/status/123",
  },
  {
    expected: "fallback",
    group: "social",
    name: "bluesky-private-recorded",
    url: "https://bsky.app/profile/private.example",
  },
  {
    expected: "happy",
    group: "community",
    name: "mastodon-recorded",
    url: "https://mastodon.social/@alice",
  },
  {
    expected: "fallback",
    group: "community",
    name: "stackexchange-empty-recorded",
    url: "https://stackoverflow.com/questions/404/missing",
  },
];

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function notFoundResponse(): Response {
  return new Response("", { status: 404 });
}

function installRecordedFetch(): void {
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("reddit.com/r/typescript/hot.json")) {
      return Promise.resolve(
        okJsonResponse({
          data: {
            children: [
              {
                data: {
                  author: "recorder",
                  num_comments: 3,
                  score: 10,
                  title: "Recorded Reddit API item",
                  url: "https://example.com/reddit",
                },
              },
            ],
          },
        })
      );
    }
    if (url.includes("hacker-news.firebaseio.com/v0/item/404.json")) {
      return Promise.resolve(notFoundResponse());
    }
    if (url.includes("publish.twitter.com/oembed")) {
      return Promise.resolve(
        okJsonResponse({
          author_name: "OpenSearch",
          html: "<blockquote>Recorded &amp; normalized status</blockquote>",
        })
      );
    }
    if (url.includes("app.bsky.actor.getProfile")) {
      return Promise.resolve(notFoundResponse());
    }
    if (url.includes("mastodon.social/api/v1/accounts/lookup")) {
      return Promise.resolve(
        okJsonResponse({
          acct: "alice",
          display_name: "Alice",
          followers_count: 5,
          id: "1",
          note: "<p>Recorded profile</p>",
          statuses_count: 2,
          username: "alice",
        })
      );
    }
    if (url.includes("mastodon.social/api/v1/accounts/1/statuses")) {
      return Promise.resolve(
        okJsonResponse([
          {
            content: "<p>Recorded status</p>",
            favourites_count: 1,
            reblogs_count: 0,
            url: "https://mastodon.social/@alice/1",
          },
        ])
      );
    }
    if (url.includes("api.stackexchange.com/2.3/questions/404/answers")) {
      return Promise.resolve(okJsonResponse({ items: [] }));
    }
    return Promise.resolve(notFoundResponse());
  };
}

async function run(): Promise<void> {
  installRecordedFetch();
  const records: QaRecord[] = [];
  for (const scenario of scenarios) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential API calls
    const result = await fetchViaPublicApi(scenario.url);
    records.push({
      // biome-ignore lint/suspicious/noUnnecessaryConditions: runtime validation of external data
      contentLength: result?.length ?? 0,
      expected: scenario.expected,
      group: scenario.group,
      name: scenario.name,
      ok: scenario.expected === "happy" ? result !== null : result === null,
      profileUsed: result?.profileUsed ?? null,
      // biome-ignore lint/suspicious/noUnnecessaryConditions: runtime validation of external data
      title: result?.title ?? null,
      url: scenario.url,
      verdict: result?.verdict ?? null,
    });
  }
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
}

await run();

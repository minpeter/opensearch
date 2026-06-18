import { describe, expect, it } from "vitest";
import {
  apiDiscoveryHint,
  buildApiDiscoveryReport,
  isApiDiscoveryEligible,
} from "../fetch/api-discovery.ts";
import type { FetchAttemptTrace } from "../fetch/result.ts";

const profiledChallenges: readonly FetchAttemptTrace[] = [
  {
    name: "probe:original",
    profileUsed: "cloudflare_turnstile",
    verdict: "challenge",
  },
  {
    name: "grid:mobile_subdomain",
    profileUsed: "cloudflare_turnstile",
    verdict: "blocked",
  },
];

describe("apiDiscoveryHint", () => {
  it("emits a hint for repeated profiled collection challenges", () => {
    expect(
      apiDiscoveryHint(
        "https://example.com/search?q=keyboard",
        profiledChallenges
      )
    ).toContain("api_discovery_hint");
  });

  it("does not emit a hint for single-document lookups", () => {
    expect(
      apiDiscoveryHint("https://example.com/articles/one", profiledChallenges)
    ).toBeUndefined();
    expect(
      isApiDiscoveryEligible(
        "https://example.com/search?q=keyboard",
        profiledChallenges,
        "document"
      )
    ).toBe(false);
  });
});

describe("buildApiDiscoveryReport", () => {
  it("filters network requests to API, GraphQL, JSON, fetch, and XHR candidates", () => {
    const report = buildApiDiscoveryReport({
      requests: [
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
          url: "https://example.com/data/catalog.json#fragment",
        },
      ],
      targetUrl: "https://example.com/products",
      trace: profiledChallenges,
    });

    expect(report.hint).toBe("api_discovery_candidates:3");
    expect(report.candidates.map((candidate) => candidate.url)).toEqual([
      "https://example.com/api/products?token=%5Bredacted%5D&page=1",
      "https://example.com/graphql?session=%5Bredacted%5D",
      "https://example.com/data/catalog.json",
    ]);
    expect(report.candidates[0]?.reasons).toEqual(["api_path", "resource:xhr"]);
    expect(report.traceSummary[0]).toContain("cloudflare_turnstile");
  });

  it("deduplicates candidates without hardcoding endpoints", () => {
    const report = buildApiDiscoveryReport({
      requests: [
        {
          method: "GET",
          resourceType: "fetch",
          url: "https://example.com/api/items",
        },
        {
          method: "GET",
          resourceType: "fetch",
          url: "https://example.com/api/items",
        },
      ],
      targetUrl: "https://example.com/list",
    });

    expect(report.candidates).toHaveLength(1);
  });
});

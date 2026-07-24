import { describe, expect, it } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { githubResult, grepResult } from "./code-search-test-helpers.ts";

describe("code search result merging and interleaving", () => {
  it("round-robins providers so one source cannot monopolize the result cap", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const grepResults = Array.from({ length: 10 }, (_, index) => ({
      ...grepResult(),
      path: `src/grep-${index}.ts`,
      url: `https://github.com/f/prompts.chat/blob/main/src/grep-${index}.ts`,
    }));
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        { name: "grep", search: () => Promise.resolve(grepResults) },
        { name: "github", search: () => Promise.resolve([githubResult()]) },
      ],
    });

    const results = await service.codeSearch("isError", { numResults: 3 });

    expect(results.map((result) => result.provider)).toContain("github");
  });

  it("dedupes identical repo/path results across providers and merges matches", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        { name: "grep", search: () => Promise.resolve([grepResult()]) },
        { name: "github", search: () => Promise.resolve([githubResult()]) },
      ],
    });

    const results = await service.codeSearch("isError");

    expect(results).toHaveLength(1);
    expect(results[0]?.matches.length).toBeGreaterThan(1);
  });

  it("dedupes forge-qualified and owner/repo identities for the same file", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        { name: "grep", search: () => Promise.resolve([grepResult()]) },
        {
          name: "sourcegraph",
          search: () =>
            Promise.resolve([
              {
                ...githubResult(),
                provider: "sourcegraph" as const,
                repo: "github.com/f/prompts.chat",
              },
            ]),
        },
      ],
    });

    const results = await service.codeSearch("isError");

    expect(results).toHaveLength(1);
    expect(results[0]?.matches).toHaveLength(2);
  });
});

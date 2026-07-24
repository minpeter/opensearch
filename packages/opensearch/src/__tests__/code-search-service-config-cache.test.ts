import { describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { githubResult, grepResult } from "./code-search-test-helpers.ts";

describe("code search service configuration and cache", () => {
  it("clamps direct-library result counts before providers receive them", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const search = vi.fn().mockResolvedValue([githubResult()]);
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [{ name: "github", search }],
    });

    await service.codeSearch("isError", { numResults: 10_000 });

    expect(search).toHaveBeenCalledWith("isError", { numResults: 30 });
  });

  it("does not expose provider error text through aggregated failures", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        {
          name: "github",
          search: () => Promise.reject(new Error("secret sk-ant-api03-leak")),
        },
      ],
    });

    await expect(
      service.codeSearch("secret", { sources: ["github"] })
    ).rejects.not.toThrow("sk-ant-api03-leak");
  });

  it("returns partial results when one provider fails", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        {
          name: "grep",
          search: () => Promise.reject(new Error("grep down")),
        },
        { name: "github", search: () => Promise.resolve([githubResult()]) },
      ],
    });

    const results = await service.codeSearch("isError");

    expect(results).toHaveLength(1);
    expect(results[0]?.provider).toBe("github");
  });

  it("throws the aggregated error when every provider fails", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        {
          name: "grep",
          search: () => Promise.reject(new Error("grep down")),
        },
        {
          name: "github",
          search: () => Promise.reject(new Error("github down")),
        },
      ],
    });

    await expect(service.codeSearch("isError")).rejects.toThrow(
      "Search failed across all engines"
    );
  });

  it("caches repeat searches and coalesces concurrent calls", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const search = vi.fn().mockResolvedValue([githubResult()]);
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [{ name: "github", search }],
    });

    await service.codeSearch("isError");
    await service.codeSearch("isError");

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("rejects Exa-only repository filters instead of returning unrelated code", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        { name: "exa-code", search: () => Promise.resolve([grepResult()]) },
      ],
    });

    await expect(
      service.codeSearch("isError", {
        repo: "owner/repo",
        sources: ["exa-code"],
      })
    ).rejects.toThrow("does not support repository or path filters");
  });

  it("rejects an explicitly requested GitHub source when no token exists", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const service = createCodeSearchService(createEnvironmentReader());

    await expect(
      service.codeSearch("isError", { sources: ["github"] })
    ).rejects.toThrow("GitHub code search requires a token");
  });

  it("activates github provider only when a token is configured", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const noToken = createCodeSearchService(createEnvironmentReader());
    const withToken = createCodeSearchService(createEnvironmentReader(), {
      githubToken: "ghp_test",
    });

    expect(noToken.providerNames).not.toContain("github");
    expect(withToken.providerNames).toContain("github");
  });
});

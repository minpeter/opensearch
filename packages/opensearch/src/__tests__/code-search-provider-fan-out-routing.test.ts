import { describe, expect, it, vi } from "vitest";

import type { CodeSearchResult } from "../code-search/types.ts";
import { createEnvironmentReader } from "../environment.ts";
import {
  deferred,
  EXA_CODE_TEXT,
  GITHUB_ITEMS,
  GREP_MCP_TEXT,
  githubResult,
  grepResult,
  SOURCEGRAPH_RESPONSE,
} from "./code-search-test-helpers.ts";

describe("code search provider parsers", () => {
  it("parses grep.app MCP text into grouped file results with line ranges", async () => {
    const { parseGrepMcpText } = await import(
      "../code-search/providers/grep-mcp.ts"
    );
    const results = parseGrepMcpText(GREP_MCP_TEXT);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: "src/pages/api/mcp.ts",
      provider: "grep",
      repo: "f/prompts.chat",
      url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
    });
    expect(results[0]?.matches).toHaveLength(2);
    expect(results[0]?.matches[0]?.lineStart).toBe(364);
    expect(results[0]?.matches[0]?.snippet).toContain("isError: true");
  });

  it("parses Exa code context markdown into semantic code results", async () => {
    const { parseExaCodeContextText } = await import(
      "../code-search/providers/exa-code.ts"
    );
    const results = parseExaCodeContextText(EXA_CODE_TEXT);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      path: "v2/servers/errors.html",
      provider: "exa-code",
      url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html",
    });
    expect(results[0]?.repo).toBe("ts.sdk.modelcontextprotocol.io");
    expect(results[0]?.matches[0]?.snippet).toContain("isError: true");
  });

  it("quotes GitHub queries and filters so qualifiers cannot be injected", async () => {
    const { buildGitHubCodeSearchUrl } = await import(
      "../code-search/providers/github.ts"
    );
    const url = new URL(
      buildGitHubCodeSearchUrl("needle repo:attacker/repo", {
        language: "Type Script",
        path: "src path/",
        repo: "owner/repo",
      })
    );

    expect(url.searchParams.get("q")).toBe(
      '"needle repo:attacker/repo" repo:"owner/repo" path:"src path/" language:"Type Script"'
    );
  });

  it("maps regexp and provider-neutral filters to GitHub query syntax", async () => {
    const { buildGitHubCodeSearchUrl } = await import(
      "../code-search/providers/github.ts"
    );
    const url = new URL(
      buildGitHubCodeSearchUrl("isError\\s*:\\s*true", {
        language: "TypeScript",
        path: "src/",
        repo: "owner/repo",
        useRegexp: true,
      })
    );

    expect(url.searchParams.get("q")).toBe(
      '/isError\\\\s*:\\\\s*true/ repo:"owner/repo" path:"src/" language:"TypeScript"'
    );
  });

  it("escapes backslashes before regexp delimiters so escaped slashes cannot break out", async () => {
    const { buildGitHubCodeSearchUrl } = await import(
      "../code-search/providers/github.ts"
    );
    const url = new URL(
      buildGitHubCodeSearchUrl("a\\/b/c", { useRegexp: true })
    );

    expect(url.searchParams.get("q")).toBe("/a\\\\\\/b\\/c/");
  });

  it("parses GitHub code search items into file-level results", async () => {
    const { parseGitHubCodeSearchResponse } = await import(
      "../code-search/providers/github.ts"
    );
    const results = parseGitHubCodeSearchResponse(GITHUB_ITEMS);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: "src/pages/api/mcp.ts",
      provider: "github",
      repo: "f/prompts.chat",
    });
    expect(results[0]?.matches[0]?.snippet).toContain("isError: true");
  });

  it("quotes Sourcegraph queries and filters so qualifiers cannot be injected", async () => {
    const { buildSourcegraphQuery } = await import(
      "../code-search/providers/sourcegraph.ts"
    );

    expect(
      buildSourcegraphQuery("needle repo:attacker/repo", {
        language: "Type Script",
        numResults: 4,
        path: "src path/",
        repo: "github.com/owner/repo",
      })
    ).toBe(
      '"needle repo:attacker/repo" repo:"github.com/owner/repo" file:"src path/" lang:"Type Script" count:4'
    );
  });

  it("parses Sourcegraph FileMatch lineMatches into grouped results", async () => {
    const { parseSourcegraphSearchResponse } = await import(
      "../code-search/providers/sourcegraph.ts"
    );
    const results = parseSourcegraphSearchResponse(SOURCEGRAPH_RESPONSE);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: "src/pages/api/mcp.ts",
      provider: "sourcegraph",
      repo: "github.com/f/prompts.chat",
    });
    expect(results[0]?.matches[0]?.lineStart).toBe(364);
  });
});

describe("code search provider fan-out and routing", () => {
  it("fans out to enabled providers in parallel and merges results", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const entered = deferred<void>();
    const grep = deferred<CodeSearchResult[]>();
    const github = deferred<CodeSearchResult[]>();
    let providerStarts = 0;
    const markStarted = () => {
      providerStarts += 1;
      if (providerStarts === 2) {
        entered.resolve();
      }
    };
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        {
          name: "grep",
          search: () => {
            markStarted();
            return grep.promise;
          },
        },
        {
          name: "github",
          search: () => {
            markStarted();
            return github.promise;
          },
        },
      ],
    });

    const searchPromise = service.codeSearch("isError");
    await entered.promise;
    expect(providerStarts).toBe(2);
    grep.resolve([
      {
        ...grepResult(),
        path: "src/grep-only.ts",
        url: "https://github.com/f/prompts.chat/blob/main/src/grep-only.ts",
      },
    ]);
    github.resolve([githubResult()]);
    const results = await searchPromise;
    expect(results.map((result) => result.provider).sort()).toEqual([
      "github",
      "grep",
    ]);
  });

  it("skips Exa when repository or path filters cannot be honored", async () => {
    const { createCodeSearchService } = await import(
      "../code-search/service.ts"
    );
    const exaSearch = vi.fn().mockResolvedValue([grepResult()]);
    const githubSearch = vi.fn().mockResolvedValue([githubResult()]);
    const service = createCodeSearchService(createEnvironmentReader(), {
      providers: [
        { name: "exa-code", search: exaSearch },
        { name: "github", search: githubSearch },
      ],
    });

    await service.codeSearch("isError", { path: "src/", repo: "owner/repo" });

    expect(exaSearch).not.toHaveBeenCalled();
    expect(githubSearch).toHaveBeenCalledOnce();
  });
});

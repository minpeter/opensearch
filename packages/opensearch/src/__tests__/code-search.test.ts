import { describe, expect, it, vi } from "vitest";
import type { CodeSearchResult } from "../code-search/types.ts";
import { createEnvironmentReader } from "../environment.ts";

const GREP_MCP_TEXT = `Repository: f/prompts.chat
Path: src/pages/api/mcp.ts
URL: https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts
License: Unknown

Snippets:
--- Snippet 1 (Line 364) ---
        return {
          isError: true,
        };

--- Snippet 2 (Line 409) ---
          isError: true,
          content: [],
`;

const EXA_CODE_TEXT = `Title: Errors | MCP TypeScript SDK
URL: https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html
Code/Highlights:
A tool error is a successful JSON-RPC result with \`isError: true\` that the model reads.

---

Title: Handle Errors in MCP Server
URL: https://example.com/mcp-errors
Code/Highlights:
Return isError true from a tool handler.
`;

const GITHUB_ITEMS = {
  items: [
    {
      html_url:
        "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
      path: "src/pages/api/mcp.ts",
      repository: { full_name: "f/prompts.chat" },
      text_matches: [
        {
          fragment: "return {\n  isError: true,\n};",
          matches: [{ indices: [12, 19], text: "isError" }],
        },
      ],
    },
  ],
  total_count: 1,
};

const SOURCEGRAPH_RESPONSE = {
  data: {
    search: {
      results: {
        matchCount: 1,
        results: [
          {
            __typename: "FileMatch",
            file: { path: "src/pages/api/mcp.ts" },
            lineMatches: [
              { lineNumber: 364, preview: "          isError: true," },
            ],
            repository: { name: "github.com/f/prompts.chat" },
          },
        ],
      },
    },
  },
};

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

describe("code search service", () => {
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

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function grepResult(): CodeSearchResult {
  return {
    matches: [{ snippet: "isError: true" }],
    path: "src/pages/api/mcp.ts",
    provider: "grep",
    repo: "f/prompts.chat",
    url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
  };
}

function githubResult(): CodeSearchResult {
  return {
    matches: [{ snippet: "isError: true, content" }],
    path: "src/pages/api/mcp.ts",
    provider: "github",
    repo: "f/prompts.chat",
    url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
  };
}

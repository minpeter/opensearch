import type { CodeSearchResult } from "../code-search/types.ts";

export const GREP_MCP_TEXT = `Repository: f/prompts.chat
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

export const EXA_CODE_TEXT = `Title: Errors | MCP TypeScript SDK
URL: https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html
Code/Highlights:
A tool error is a successful JSON-RPC result with \`isError: true\` that the model reads.

---

Title: Handle Errors in MCP Server
URL: https://example.com/mcp-errors
Code/Highlights:
Return isError true from a tool handler.
`;

export const GITHUB_ITEMS = {
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

export const SOURCEGRAPH_RESPONSE = {
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

export function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

export function grepResult(): CodeSearchResult {
  return {
    matches: [{ snippet: "isError: true" }],
    path: "src/pages/api/mcp.ts",
    provider: "grep",
    repo: "f/prompts.chat",
    url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
  };
}

export function githubResult(): CodeSearchResult {
  return {
    matches: [{ snippet: "isError: true, content" }],
    path: "src/pages/api/mcp.ts",
    provider: "github",
    repo: "f/prompts.chat",
    url: "https://github.com/f/prompts.chat/blob/main/src/pages/api/mcp.ts",
  };
}

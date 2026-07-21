import type {
  CodeSearchMatch,
  CodeSearchOptions,
  CodeSearchResult,
} from "../types.ts";
import { callMcpTool } from "./mcp-client.ts";

const GREP_MCP_URL = "https://mcp.grep.app";
const GREP_SEARCH_TOOL = "searchGitHub";
const MAX_SNIPPETS_PER_FILE = 5;

const REPO_HEADER_REGEX = /^Repository: (.+)$/mu;
const PATH_HEADER_REGEX = /^Path: (.+)$/mu;
const URL_HEADER_REGEX = /^URL: (.+)$/mu;
const LICENSE_HEADER_REGEX = /^License: (.+)$/mu;
const SNIPPET_HEADER_REGEX = /^--- Snippet \d+ \(Line (\d+)\) ---$/;

export async function searchGrepMcp(
  query: string,
  options: CodeSearchOptions = {}
): Promise<CodeSearchResult[]> {
  const content = await callMcpTool(
    GREP_MCP_URL,
    "opensearch",
    GREP_SEARCH_TOOL,
    {
      ...(options.language ? { language: [options.language] } : {}),
      ...(options.path ? { path: options.path } : {}),
      query,
      ...(options.repo ? { repo: options.repo } : {}),
      useRegexp: options.useRegexp ?? false,
    }
  );

  return parseGrepMcpText(
    content
      .map((item) => item.text ?? "")
      .join("\n")
      .trim()
  );
}

export function parseGrepMcpText(text: string): CodeSearchResult[] {
  const results: CodeSearchResult[] = [];
  let current:
    | (Omit<CodeSearchResult, "matches"> & { matches: CodeSearchMatch[] })
    | undefined;
  let snippetLineStart: number | undefined;
  let snippetLines: string[] = [];

  const flushSnippet = () => {
    if (!(current && snippetLineStart !== undefined)) {
      return;
    }
    const snippet = snippetLines.join("\n").trim();
    if (snippet) {
      current.matches.push({
        lineEnd: snippetLineStart + snippetLines.length - 1,
        lineStart: snippetLineStart,
        snippet,
      });
    }
    snippetLineStart = undefined;
    snippetLines = [];
  };

  const flushResult = () => {
    flushSnippet();
    if (current && current.matches.length > 0) {
      results.push({
        ...current,
        matches: current.matches.slice(0, MAX_SNIPPETS_PER_FILE),
      });
    }
    current = undefined;
  };

  for (const line of text.split("\n")) {
    const repoMatch = REPO_HEADER_REGEX.exec(line);
    if (repoMatch?.[1]) {
      flushResult();
      current = {
        license: undefined,
        matches: [],
        path: "",
        provider: "grep",
        repo: repoMatch[1].trim(),
        url: "",
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const pathMatch = PATH_HEADER_REGEX.exec(line);
    if (pathMatch?.[1]) {
      current.path = pathMatch[1].trim();
      continue;
    }
    const urlMatch = URL_HEADER_REGEX.exec(line);
    if (urlMatch?.[1]) {
      current.url = urlMatch[1].trim();
      continue;
    }
    const licenseMatch = LICENSE_HEADER_REGEX.exec(line);
    if (licenseMatch?.[1]) {
      const license = licenseMatch[1].trim();
      current.license = license === "Unknown" ? undefined : license;
      continue;
    }
    const snippetMatch = SNIPPET_HEADER_REGEX.exec(line);
    if (snippetMatch?.[1]) {
      flushSnippet();
      snippetLineStart = Number.parseInt(snippetMatch[1], 10);
      continue;
    }
    if (snippetLineStart !== undefined) {
      snippetLines.push(line);
    }
  }
  flushResult();

  return results;
}

import type { CodeSearchOptions, CodeSearchResult } from "../types.ts";
import { callMcpTool } from "./mcp-client.ts";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp?tools=get_code_context_exa";
const EXA_CODE_TOOL = "get_code_context_exa";
const DEFAULT_NUM_RESULTS = 8;

const TITLE_REGEX = /^Title: (.+)$/u;
const URL_REGEX = /^URL: (.+)$/u;
const HIGHLIGHTS_REGEX = /^Code\/Highlights:$/u;
const SEPARATOR_REGEX = /^\s*---\s*$/mu;
const LEADING_SLASH_REGEX = /^\//u;

export async function searchExaCodeContext(
  query: string,
  options: CodeSearchOptions = {}
): Promise<CodeSearchResult[]> {
  const content = await callMcpTool(EXA_MCP_URL, "opensearch", EXA_CODE_TOOL, {
    numResults: options.numResults ?? DEFAULT_NUM_RESULTS,
    query: options.language ? `${options.language} ${query}` : query,
  });

  return parseExaCodeContextText(
    content
      .map((item) => item.text ?? "")
      .join("\n")
      .trim()
  );
}

export function parseExaCodeContextText(text: string): CodeSearchResult[] {
  const results: CodeSearchResult[] = [];

  for (const block of text.split(SEPARATOR_REGEX)) {
    const lines = block.split("\n");
    const titleLine = lines.find((line) => TITLE_REGEX.test(line));
    const urlLine = lines.find((line) => URL_REGEX.test(line));
    if (!(titleLine && urlLine)) {
      continue;
    }
    const url = URL_REGEX.exec(urlLine)?.[1]?.trim() ?? "";
    const highlightsIndex = lines.findIndex((line) =>
      HIGHLIGHTS_REGEX.test(line)
    );
    const snippet = lines
      .slice(highlightsIndex >= 0 ? highlightsIndex + 1 : 0)
      .join("\n")
      .trim();
    if (!(url && snippet)) {
      continue;
    }
    const host = safeHost(url);
    results.push({
      matches: [{ snippet }],
      path: safePath(url),
      provider: "exa-code",
      repo: host,
      url,
    });
  }

  return results;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(LEADING_SLASH_REGEX, "");
  } catch {
    return "";
  }
}

import { requireTrustedProviderBaseUrl } from "./search/api-provider-utils.ts";

export const DEFAULT_EXA_MCP_SERVER_URL = "https://mcp.exa.ai/mcp";
export const DEFAULT_EXA_MCP_FETCH_TOOL = "web_fetch_exa";
export const DEFAULT_EXA_MCP_SEARCH_TOOL = "web_search_exa";
const EXA_MCP_URL_ENV = "OPENSEARCH_EXA_MCP_URL";
const EXA_FETCH_TITLE_PREFIX = "# ";
const EXA_FETCH_URL_PREFIX = "URL:";
const EXA_FETCH_PUBLISHED_PREFIX = "Published:";
const EXA_FETCH_AUTHOR_PREFIX = "Author:";
const SEARCH_RESULT_SEPARATOR = /\n\s*---\s*\n/gu;
const MAX_SNIPPET_LENGTH = 280;

export interface ExaMcpSearchResult {
  engine: "Exa";
  snippet: string;
  title: string;
  url: string;
}

export interface ExaMcpFetchResult {
  content: string;
  title: string;
  url: string;
}

export interface ExaMcpContentItem {
  text?: string;
  type?: string;
}

export function createExaMcpServerUrl(
  baseUrl = DEFAULT_EXA_MCP_SERVER_URL,
  enabledTools: string[] = [DEFAULT_EXA_MCP_SEARCH_TOOL]
): string {
  const url = new URL(requireTrustedProviderBaseUrl(EXA_MCP_URL_ENV, baseUrl));
  const normalizedTools = [
    ...new Set(enabledTools.map((tool) => tool.trim()).filter(Boolean)),
  ];

  if (normalizedTools.length === 0) {
    url.searchParams.delete("tools");
    return url.toString();
  }

  url.searchParams.set("tools", normalizedTools.join(","));
  return url.toString();
}

export function parseExaMcpContentItems(
  content: ExaMcpContentItem[] | undefined
): ExaMcpSearchResult[] {
  if (!content) {
    return [];
  }

  const results = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .flatMap((item) => parseExaMcpSearchToolText(item.text ?? ""));

  return dedupeByUrl(results);
}

export function parseExaMcpFetchContentItem(
  content: ExaMcpContentItem[] | undefined
): ExaMcpFetchResult | null {
  return parseExaMcpFetchContentItems(content)[0] ?? null;
}

export function parseExaMcpFetchContentItems(
  content: ExaMcpContentItem[] | undefined
): ExaMcpFetchResult[] {
  if (!content) {
    return [];
  }

  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => parseExaMcpFetchText(item.text ?? ""))
    .filter((result): result is ExaMcpFetchResult => result !== null);
}

export function parseExaMcpSearchToolText(text: string): ExaMcpSearchResult[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return [];
  }

  const blocks = trimmedText.split(SEARCH_RESULT_SEPARATOR);

  const results = blocks
    .map((block) => parseExaMcpResultBlock(block))
    .filter((result): result is ExaMcpSearchResult => result !== null);

  return dedupeByUrl(results);
}

function parseExaMcpResultBlock(block: string): ExaMcpSearchResult | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  let title = "";
  let url = "";
  let snippet = "";
  let activeMultilineField: "highlights" | null = null;
  const highlightLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("Title:")) {
      title = trimmedLine.slice("Title:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (trimmedLine.startsWith("URL:")) {
      url = trimmedLine.slice("URL:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (trimmedLine.startsWith("Highlights:")) {
      activeMultilineField = "highlights";
      const inlineHighlights = trimmedLine.slice("Highlights:".length).trim();
      if (inlineHighlights) {
        highlightLines.push(inlineHighlights);
      }
      continue;
    }

    if (trimmedLine.startsWith("Text:")) {
      snippet = trimmedLine.slice("Text:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (
      trimmedLine.startsWith("Published:") ||
      trimmedLine.startsWith("Author:")
    ) {
      activeMultilineField = null;
      continue;
    }

    if (activeMultilineField === "highlights") {
      highlightLines.push(trimmedLine);
    }
  }

  const normalizedSnippet = truncateText(
    cleanText(highlightLines[0] ?? snippet),
    MAX_SNIPPET_LENGTH
  );

  if (!(title && url && normalizedSnippet)) {
    return null;
  }

  return {
    engine: "Exa",
    snippet: normalizedSnippet,
    title,
    url,
  };
}

function dedupeByUrl(results: ExaMcpSearchResult[]): ExaMcpSearchResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

export function parseExaMcpFetchText(text: string): ExaMcpFetchResult | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const lines = normalizedText.split("\n");
  const titleLine = lines.find((line) =>
    line.startsWith(EXA_FETCH_TITLE_PREFIX)
  );
  const urlLine = lines.find((line) => line.startsWith(EXA_FETCH_URL_PREFIX));

  if (!(titleLine && urlLine)) {
    return null;
  }

  const contentStartIndex = lines.findIndex(
    (line, index) =>
      index > lines.indexOf(urlLine) &&
      !line.startsWith(EXA_FETCH_PUBLISHED_PREFIX) &&
      !line.startsWith(EXA_FETCH_AUTHOR_PREFIX) &&
      line.trim().length > 0
  );

  const content = (
    contentStartIndex === -1
      ? normalizedText
      : lines.slice(contentStartIndex).join("\n")
  ).trim();

  if (!content) {
    return null;
  }

  return {
    content,
    title: titleLine.slice(EXA_FETCH_TITLE_PREFIX.length).trim(),
    url: urlLine.slice(EXA_FETCH_URL_PREFIX.length).trim(),
  };
}

function cleanText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncatedText = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = truncatedText.lastIndexOf(" ");

  if (lastSpaceIndex <= maxLength / 2) {
    return `${truncatedText}…`;
  }

  return `${truncatedText.slice(0, lastSpaceIndex)}…`;
}

import { z } from "zod";

import { normalizeResult } from "./search/text.ts";

export const DEFAULT_PARALLEL_MCP_SERVER_URL = "https://search.parallel.ai/mcp";
export const DEFAULT_PARALLEL_MCP_SEARCH_TOOL = "web_search";

const PARALLEL_RESULT_SCHEMA = z.object({
  content: z.string().optional(),
  description: z.string().optional(),
  excerpts: z.union([z.array(z.string()), z.string()]).optional(),
  snippet: z.string().optional(),
  title: z.string().nullable().optional(),
  url: z.string().optional(),
});

const PARALLEL_RESPONSE_SCHEMA = z.object({
  results: z.array(PARALLEL_RESULT_SCHEMA),
});

const PARALLEL_CONTENT_ITEMS_SCHEMA = z.array(
  z.object({
    text: z.string().optional(),
    type: z.string().optional(),
  })
);

export interface ParallelMcpSearchResult {
  readonly engine: "Parallel";
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export function parseParallelMcpPayload(
  payload: unknown
): ParallelMcpSearchResult[] {
  const parsed = PARALLEL_RESPONSE_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  const results = parsed.data.results
    .map((item) => {
      const excerpts = Array.isArray(item.excerpts)
        ? item.excerpts.join(" ")
        : item.excerpts;
      const normalizedResult = normalizeResult({
        snippet:
          item.snippet ?? item.description ?? item.content ?? excerpts ?? "",
        title: item.title ?? "",
        url: item.url ?? "",
      });

      return normalizedResult === null
        ? null
        : ({
            ...normalizedResult,
            engine: "Parallel",
          } satisfies ParallelMcpSearchResult);
    })
    .filter((result): result is ParallelMcpSearchResult => result !== null);

  return dedupeByUrl(results);
}

export function parseParallelMcpToolText(
  text: string
): ParallelMcpSearchResult[] {
  try {
    const payload: unknown = JSON.parse(text);
    return parseParallelMcpPayload(payload);
  } catch {
    return [];
  }
}

export function parseParallelMcpContentItems(
  content: unknown
): ParallelMcpSearchResult[] {
  const parsed = PARALLEL_CONTENT_ITEMS_SCHEMA.safeParse(content);
  if (!parsed.success) {
    return [];
  }

  const results = parsed.data
    .filter((item) => item.type === "text" && item.text)
    .flatMap((item) => parseParallelMcpToolText(item.text ?? ""));

  return dedupeByUrl(results);
}

function dedupeByUrl(
  results: readonly ParallelMcpSearchResult[]
): ParallelMcpSearchResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

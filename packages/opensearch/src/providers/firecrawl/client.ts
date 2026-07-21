import { z } from "zod";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { FIRECRAWL_TIMEOUT_MS, requestFirecrawlJson } from "./request.ts";

export const OPENSEARCH_ENABLE_FIRECRAWL_ENV = "OPENSEARCH_ENABLE_FIRECRAWL";

const FIRECRAWL_SEARCH_MARKDOWN_MAX_CHARACTERS = 1200;

const optionalStringSchema = z.string().nullable().optional();

const firecrawlSearchResponseSchema = z.object({
  data: z.object({
    web: z
      .array(
        z.object({
          description: optionalStringSchema,
          markdown: optionalStringSchema,
          metadata: z
            .object({
              description: optionalStringSchema,
              sourceURL: optionalStringSchema,
              title: optionalStringSchema,
              url: optionalStringSchema,
            })
            .nullable()
            .optional(),
          title: optionalStringSchema,
          url: optionalStringSchema,
        })
      )
      .default([]),
  }),
});

const firecrawlScrapeResponseSchema = z.object({
  data: z.object({
    markdown: optionalStringSchema,
    metadata: z
      .object({
        sourceURL: optionalStringSchema,
        title: optionalStringSchema,
        url: optionalStringSchema,
      })
      .nullable()
      .optional(),
  }),
});

export interface FirecrawlSearchResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export interface FirecrawlFetchResult {
  readonly content: string;
  readonly title: string;
}

export async function searchFirecrawl(
  query: string,
  numResults: number,
  env: EnvironmentReader = processEnvironmentReader,
  options: { readonly useApiKey?: boolean } = {}
): Promise<FirecrawlSearchResult[]> {
  const payload = await requestFirecrawlJson({
    body: {
      limit: numResults,
      query,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        parsers: ["pdf"],
        removeBase64Images: true,
      },
      sources: ["web"],
    },
    endpoint: "search",
    env,
    useApiKey: options.useApiKey ?? true,
  });
  const response = firecrawlSearchResponseSchema.parse(payload);

  return response.data.web
    .map((item) => ({
      snippet: createFirecrawlSearchSnippet(item),
      title: item.title ?? item.metadata?.title ?? "",
      url: item.url ?? item.metadata?.sourceURL ?? item.metadata?.url ?? "",
    }))
    .filter((result) => result.url.length > 0);
}

export async function fetchFirecrawlUrl(
  url: string,
  maxCharacters: number,
  env: EnvironmentReader = processEnvironmentReader
): Promise<FirecrawlFetchResult> {
  const payload = await requestFirecrawlJson({
    body: {
      blockAds: true,
      formats: ["markdown"],
      onlyCleanContent: true,
      onlyMainContent: true,
      parsers: ["pdf"],
      proxy: "auto",
      removeBase64Images: true,
      timeout: FIRECRAWL_TIMEOUT_MS,
      url,
    },
    endpoint: "scrape",
    env,
    useApiKey: true,
  });
  const response = firecrawlScrapeResponseSchema.parse(payload);
  const markdown = response.data.markdown?.trim();

  if (!markdown) {
    throw new Error("Firecrawl scrape returned no markdown content");
  }

  return {
    content: markdown.slice(0, maxCharacters),
    title: response.data.metadata?.title ?? "",
  };
}

function createFirecrawlSearchSnippet(item: {
  readonly description?: string | null;
  readonly markdown?: string | null;
  readonly metadata?: { readonly description?: string | null } | null;
}): string {
  return (
    item.description ??
    item.markdown?.slice(0, FIRECRAWL_SEARCH_MARKDOWN_MAX_CHARACTERS) ??
    item.metadata?.description ??
    ""
  );
}

export function isFirecrawlEnabled(
  env: EnvironmentReader = processEnvironmentReader
): boolean {
  return env.read(OPENSEARCH_ENABLE_FIRECRAWL_ENV) !== "false";
}

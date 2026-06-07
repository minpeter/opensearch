import { type CheerioAPI, load } from "cheerio";
import { z } from "zod";

import { dedupeResults, normalizeResult, stripHtmlTags } from "./text.ts";
import type { ParsedResult } from "./types.ts";

const WIKIPEDIA_RESPONSE_SCHEMA = z.object({
  query: z.object({
    search: z.array(
      z.object({
        pageid: z.number(),
        snippet: z.string().optional(),
        title: z.string().optional(),
      })
    ),
  }),
});

const ARCHIVE_RESPONSE_SCHEMA = z.object({
  response: z.object({
    docs: z.array(
      z.object({
        description: z.union([z.string(), z.array(z.string())]).optional(),
        identifier: z.string().optional(),
        title: z.string().optional(),
      })
    ),
  }),
});

export function parseStartpageResults(html: string): ParsedResult[] {
  const $ = load(html);
  const cards = $(".result").length
    ? $(".result")
    : $(".result-title").parent();
  const results: ParsedResult[] = [];

  cards.each((_, element) => {
    const card = $(element);
    card.find("style").remove();
    const anchor = card.find("a.result-title[href]").first();
    const result = normalizeResult({
      snippet: card.find(".description").first().text(),
      title: anchor.find("h2").first().text() || anchor.text(),
      url: anchor.attr("href") ?? "",
    });
    if (result) {
      results.push(result);
    }
  });

  return dedupeResults(results);
}

export function parseWebcrawlerResults(html: string): ParsedResult[] {
  const $ = load(html);
  return collectHtmlResults(
    $,
    ".web-google__result, .web-bing__result",
    (card) => {
      const anchor = card
        .find("a.web-google__title, a.web-bing__title")
        .first();
      return {
        snippet:
          card
            .find(".web-google__description, .web-bing__description")
            .text() || card.find("p").first().text(),
        title: anchor.text(),
        url: anchor.attr("href") ?? "",
      };
    }
  );
}

export function parseWibyResults(html: string): ParsedResult[] {
  const $ = load(html);
  return collectHtmlResults($, "blockquote", (card) => {
    const anchor = card.find("a.tlink[href]").first();
    return {
      snippet: card.find("p").not(".url").first().text(),
      title: anchor.text(),
      url: anchor.attr("href") ?? "",
    };
  });
}

export function parseWikipediaResults(payload: unknown): ParsedResult[] {
  const parsed = WIKIPEDIA_RESPONSE_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.query.search
    .map((item) =>
      normalizeResult({
        snippet: stripHtmlTags(item.snippet ?? ""),
        title: item.title ?? "",
        url: `https://en.wikipedia.org/?curid=${item.pageid}`,
      })
    )
    .filter((result): result is ParsedResult => result !== null);
}

export function parseInternetArchiveResults(payload: unknown): ParsedResult[] {
  const parsed = ARCHIVE_RESPONSE_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.response.docs
    .map((item) => {
      const description = Array.isArray(item.description)
        ? item.description.join(" ")
        : item.description;
      return normalizeResult({
        snippet: description ?? item.title ?? "",
        title: item.title ?? item.identifier ?? "",
        url: item.identifier
          ? `https://archive.org/details/${item.identifier}`
          : "",
      });
    })
    .filter((result): result is ParsedResult => result !== null);
}

function collectHtmlResults(
  $: CheerioAPI,
  selector: string,
  getResult: (card: ReturnType<CheerioAPI>) => ParsedResult
): ParsedResult[] {
  const results: ParsedResult[] = [];
  $(selector).each((_, element) => {
    const fragment = load($.html(element) ?? "");
    const result = normalizeResult(getResult(fragment.root()));
    if (result) {
      results.push(result);
    }
  });
  return dedupeResults(results);
}

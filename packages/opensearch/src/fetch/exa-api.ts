import { z } from "zod";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { DEFAULT_MAX_CHARACTERS, EXA_API_KEY_ENV } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

const EXA_API_TIMEOUT_MS = 10_000;
const EXA_CONTENTS_API_URL = "https://api.exa.ai/contents";

const exaContentsResponseSchema = z.object({
  results: z
    .array(
      z.object({
        text: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .default([]),
  statuses: z
    .array(
      z.object({
        id: z.string().optional(),
        status: z.string(),
        error: z
          .object({
            httpStatusCode: z.number().optional(),
            tag: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

type ExaContentsStatus = z.infer<
  typeof exaContentsResponseSchema
>["statuses"] extends (infer Status)[] | undefined
  ? Status
  : never;

export async function fetchExaApi(
  url: string,
  env: EnvironmentReader = processEnvironmentReader
): Promise<FetchResult> {
  const [result] = await fetchExaApiBatch([url], undefined, env);

  if (!result) {
    throw new Error("Exa API fetch returned no text content");
  }

  return result;
}

export async function fetchExaApiBatch(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS,
  env: EnvironmentReader = processEnvironmentReader
): Promise<FetchResult[]> {
  const apiKey = env.read(EXA_API_KEY_ENV)?.trim();
  if (!apiKey) {
    throw new Error("Exa API key is not configured");
  }

  const response = await fetch(EXA_CONTENTS_API_URL, {
    body: JSON.stringify({
      text: {
        maxCharacters,
      },
      urls,
    }),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(EXA_API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Exa API fetch failed with status ${response.status}`);
  }

  const payload = exaContentsResponseSchema.parse(await response.json());
  const statusesById = new Map(
    (payload.statuses ?? [])
      .map((status) => (status.id ? ([status.id, status] as const) : null))
      .filter(
        (entry): entry is readonly [string, ExaContentsStatus] => entry !== null
      )
  );
  const resultsByUrl = new Map(
    payload.results
      .filter((result) => result.url && result.text?.trim())
      .map((result) => [result.url as string, result] as const)
  );

  const normalizedResults: FetchResult[] = [];

  for (const [index, url] of urls.entries()) {
    const status = statusesById.get(url) ?? payload.statuses?.[index];

    if (status?.status === "error") {
      const errorTag = status.error?.tag ?? "unknown-error";
      const errorCode = status.error?.httpStatusCode;
      throw new Error(
        errorCode
          ? `Exa API fetch failed: ${errorTag} (${errorCode})`
          : `Exa API fetch failed: ${errorTag}`
      );
    }

    const result =
      resultsByUrl.get(url) ??
      payload.results.find(
        (entry) => entry.text?.trim() && entry.url === url
      ) ??
      payload.results[index];

    if (!result?.text?.trim()) {
      throw new Error("Exa API fetch returned no text content");
    }

    normalizedResults.push(
      createFetchResult(url, result.text, result.title ?? "")
    );
  }

  return normalizedResults;
}

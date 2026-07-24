import { z } from "zod";
import type { ApiKeyPool } from "../credentials/api-key-pool.ts";
import { ProviderHttpError } from "../providers/shared/error.ts";
import { cancelResponseBody, readResponseJson } from "../response-body.ts";
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
        error: z
          .object({
            httpStatusCode: z.number().optional(),
            tag: z.string().optional(),
          })
          .optional(),
        id: z.string().optional(),
        status: z.string(),
      })
    )
    .optional(),
});

type ExaContentsStatus = z.infer<
  typeof exaContentsResponseSchema
>["statuses"] extends (infer Status)[] | undefined
  ? Status
  : never;

export async function fetchExaApiBatchWithPool(
  urls: string[],
  maxCharacters: number,
  apiKeyPool: ApiKeyPool
): Promise<FetchResult[]> {
  const attemptOrder = apiKeyPool.getAttemptOrder();
  if (attemptOrder.length === 0) {
    throw new Error("Exa API key is not configured");
  }

  let lastRateLimitError: Error | null = null;

  for (const apiKey of attemptOrder) {
    // biome-ignore lint/performance/noAwaitInLoops: API keys are retried sequentially after rate-limit responses
    const response = await requestExaContents(apiKey, urls, maxCharacters);
    if (response.status === 429) {
      await cancelResponseBody(response);
      lastRateLimitError = new ProviderHttpError(
        `Exa API fetch failed with status ${response.status}`,
        response.status
      );
      continue;
    }

    return parseExaContentsResponse(response, urls);
  }

  if (lastRateLimitError) {
    throw lastRateLimitError;
  }

  throw new Error("Exa API key is not configured");
}

function requestExaContents(
  apiKey: string,
  urls: readonly string[],
  maxCharacters: number
): Promise<Response> {
  return fetch(EXA_CONTENTS_API_URL, {
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
}

async function parseExaContentsResponse(
  response: Response,
  urls: readonly string[]
): Promise<FetchResult[]> {
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new ProviderHttpError(
      `Exa API fetch failed with status ${response.status}`,
      response.status
    );
  }

  const payload = exaContentsResponseSchema.parse(
    await readResponseJson(response)
  );
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
      if (errorCode !== undefined) {
        throw new ProviderHttpError(
          `Exa API fetch failed: ${errorTag} (${errorCode})`,
          errorCode
        );
      }
      throw new Error(`Exa API fetch failed: ${errorTag}`);
    }

    const result = resultsByUrl.get(url) ?? payload.results[index];

    if (!result?.text?.trim()) {
      throw new Error("Exa API fetch returned no text content");
    }

    normalizedResults.push(
      createFetchResult(url, result.text, result.title ?? "")
    );
  }

  return normalizedResults;
}

import { readResponseText } from "../../response-body.ts";
import { composeAbortSignal } from "../shared/abort.ts";
import { ProviderHttpError } from "../shared/error.ts";
import {
  getTinyFishApiKeyAttemptOrder,
  type TinyFishApiKeyPool,
} from "./api-key-pool.ts";

export const TINYFISH_TIMEOUT_MS = 30_000;
const TINYFISH_ERROR_DETAIL_MAX_CHARACTERS = 4096;

type TinyFishServiceName = "fetch" | "search";

interface TinyFishRequestOptions {
  readonly apiKeyPool?: TinyFishApiKeyPool;
  readonly signal?: AbortSignal;
}

export async function requestTinyFishJson(
  serviceName: TinyFishServiceName,
  requestWithApiKey: (apiKey: string, signal: AbortSignal) => Promise<Response>,
  requestOptions: TinyFishRequestOptions | TinyFishApiKeyPool = {}
): Promise<unknown> {
  const options =
    "getAttemptOrder" in requestOptions
      ? { apiKeyPool: requestOptions }
      : requestOptions;
  let requestSignal: AbortSignal | undefined;
  try {
    options.signal?.throwIfAborted();
    const [firstApiKey, ...remainingApiKeys] =
      options.apiKeyPool?.getAttemptOrder() ?? getTinyFishApiKeyAttemptOrder();
    if (!firstApiKey) {
      throw new Error("TINYFISH_API_KEY is not configured");
    }

    requestSignal = composeAbortSignal(options.signal, TINYFISH_TIMEOUT_MS);
    const firstResponse = await requestWithApiKey(firstApiKey, requestSignal);
    requestSignal.throwIfAborted();
    if (firstResponse.status !== 429) {
      return await parseTinyFishJsonResponse(firstResponse, serviceName);
    }

    let lastRateLimitError = await readTinyFishHttpError(
      firstResponse,
      serviceName
    );
    requestSignal.throwIfAborted();

    for (const apiKey of remainingApiKeys) {
      options.signal?.throwIfAborted();
      requestSignal = composeAbortSignal(options.signal, TINYFISH_TIMEOUT_MS);
      // biome-ignore lint/performance/noAwaitInLoops: sequential API key fallback prevents unnecessary concurrent requests
      const response = await requestWithApiKey(apiKey, requestSignal);
      requestSignal.throwIfAborted();
      if (response.status !== 429) {
        return await parseTinyFishJsonResponse(response, serviceName);
      }

      lastRateLimitError = await readTinyFishHttpError(response, serviceName);
      requestSignal.throwIfAborted();
    }

    if (remainingApiKeys.length === 0) {
      throw lastRateLimitError;
    }

    throw new Error(
      `${lastRateLimitError.message} (all ${
        remainingApiKeys.length + 1
      } configured TinyFish API keys returned HTTP 429)`
    );
  } catch (error) {
    options.signal?.throwIfAborted();
    requestSignal?.throwIfAborted();
    throw error;
  }
}

async function parseTinyFishJsonResponse(
  response: Response,
  serviceName: TinyFishServiceName
): Promise<unknown> {
  const bodyText = await readResponseText(response);
  const { parseError, value } = parseJsonBody(bodyText);

  if (!response.ok) {
    throw createTinyFishHttpError(response, serviceName, value, parseError);
  }

  if (parseError) {
    throw new Error(`TinyFish returned invalid JSON: ${parseError}`);
  }

  return value;
}

async function readTinyFishHttpError(
  response: Response,
  serviceName: TinyFishServiceName
): Promise<Error> {
  let bodyText: string;
  try {
    bodyText = await readResponseText(response);
  } catch (error) {
    return createTinyFishHttpError(
      response,
      serviceName,
      {},
      error instanceof Error ? error.message : String(error)
    );
  }
  const { parseError, value } = parseJsonBody(bodyText);

  return createTinyFishHttpError(response, serviceName, value, parseError);
}

function createTinyFishHttpError(
  response: Response,
  serviceName: TinyFishServiceName,
  body: unknown,
  parseError?: string
): ProviderHttpError {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMessage = retryAfter ? ` Retry-After: ${retryAfter}.` : "";

  return new ProviderHttpError(
    `TinyFish ${serviceName} request failed with HTTP ${
      response.status
    }: ${readErrorMessage(body, parseError)}.${retryAfterMessage}`,
    response.status
  );
}

function parseJsonBody(bodyText: string): {
  readonly parseError?: string;
  readonly value: unknown;
} {
  if (!bodyText.trim()) {
    return { value: {} };
  }

  try {
    const value: unknown = JSON.parse(bodyText);
    return { value };
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
      value: bodyText,
    };
  }
}

function readErrorMessage(body: unknown, parseError?: string): string {
  if (parseError) {
    return `invalid JSON response body: ${parseError}`;
  }

  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "string") {
      return error.slice(0, TINYFISH_ERROR_DETAIL_MAX_CHARACTERS);
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const { message } = error;
      if (typeof message === "string") {
        return message.slice(0, TINYFISH_ERROR_DETAIL_MAX_CHARACTERS);
      }
    }
  }

  return "unknown error";
}

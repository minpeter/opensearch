import {
  getTinyFishApiKeyAttemptOrder,
  type TinyFishApiKeyPool,
} from "./api-key-pool.ts";

export const TINYFISH_TIMEOUT_MS = 30_000;

type TinyFishServiceName = "fetch" | "search";

export async function requestTinyFishJson(
  serviceName: TinyFishServiceName,
  requestWithApiKey: (apiKey: string) => Promise<Response>,
  apiKeyPool?: TinyFishApiKeyPool
): Promise<unknown> {
  const [firstApiKey, ...remainingApiKeys] =
    apiKeyPool?.getAttemptOrder() ?? getTinyFishApiKeyAttemptOrder();
  if (!firstApiKey) {
    throw new Error("TINYFISH_API_KEY is not configured");
  }

  const firstResponse = await requestWithApiKey(firstApiKey);
  if (firstResponse.status !== 429) {
    return parseTinyFishJsonResponse(firstResponse, serviceName);
  }

  let lastRateLimitError = await readTinyFishHttpError(
    firstResponse,
    serviceName
  );

  for (const apiKey of remainingApiKeys) {
    const response = await requestWithApiKey(apiKey);
    if (response.status !== 429) {
      return parseTinyFishJsonResponse(response, serviceName);
    }

    lastRateLimitError = await readTinyFishHttpError(response, serviceName);
  }

  if (remainingApiKeys.length === 0) {
    throw lastRateLimitError;
  }

  throw new Error(
    `${lastRateLimitError.message} (all ${
      remainingApiKeys.length + 1
    } configured TinyFish API keys returned HTTP 429)`
  );
}

async function parseTinyFishJsonResponse(
  response: Response,
  serviceName: TinyFishServiceName
): Promise<unknown> {
  const bodyText = await response.text();
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
  const bodyText = await response.text();
  const { parseError, value } = parseJsonBody(bodyText);

  return createTinyFishHttpError(response, serviceName, value, parseError);
}

function createTinyFishHttpError(
  response: Response,
  serviceName: TinyFishServiceName,
  body: unknown,
  parseError?: string
): Error {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMessage = retryAfter ? ` Retry-After: ${retryAfter}.` : "";

  return new Error(
    `TinyFish ${serviceName} request failed with HTTP ${
      response.status
    }: ${readErrorMessage(body, parseError)}.${retryAfterMessage}`
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
    const error = body.error;
    if (typeof error === "string") {
      return error;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = error.message;
      if (typeof message === "string") {
        return message;
      }
    }
  }

  return "unknown error";
}

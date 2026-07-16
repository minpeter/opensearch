import {
  getHttpStatus,
  ProviderHttpError,
} from "../../providers/shared/error.ts";
import {
  cancelResponseBody,
  readResponseJson,
  readResponseText,
} from "../../response-body.ts";
import { getRandomUserAgent } from "../../user-agents.ts";

const API_TIMEOUT_MS = 10_000;

export async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": getRandomUserAgent(),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (response.status === 451) {
      await cancelResponseBody(response);
      throw new ProviderHttpError(
        `Public API request failed with HTTP ${response.status}`,
        response.status
      );
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return null;
    }
    return await readResponseJson(response);
  } catch (error) {
    if (getHttpStatus(error) === 451) {
      throw error;
    }
    return null;
  }
}

export async function getText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain, application/xml, text/xml",
        "User-Agent": getRandomUserAgent(),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (response.status === 451) {
      await cancelResponseBody(response);
      throw new ProviderHttpError(
        `Public API request failed with HTTP ${response.status}`,
        response.status
      );
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      return null;
    }
    return await readResponseText(response);
  } catch (error) {
    if (getHttpStatus(error) === 451) {
      throw error;
    }
    return null;
  }
}

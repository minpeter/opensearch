import type { z } from "zod";

import { DEFAULT_MAX_DOWNLOAD_BYTES } from "../../fetch/local-options.ts";
import { readResponseText } from "../../response-body.ts";
import { OllamaHttpError } from "./config.ts";

const DELTA_SECONDS_REGEX = /^\d+$/u;

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) {
    return null;
  }

  if (DELTA_SECONDS_REGEX.test(header)) {
    return Number.parseInt(header, 10);
  }

  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
}

async function ensureOk(
  response: Response,
  label: string,
  maxResponseBytes: number
): Promise<void> {
  if (response.ok) {
    return;
  }

  const retryAfter = parseRetryAfter(response);
  const body = await readResponseText(response, maxResponseBytes).catch(
    () => ""
  );
  const detail = body.trim().slice(0, 4096) || response.statusText;
  throw new OllamaHttpError(
    response.status,
    `Ollama ${label} failed (HTTP ${response.status}): ${detail}`,
    retryAfter
  );
}

export async function postOllamaJson<T>(
  url: string,
  body: unknown,
  options: {
    readonly headers?: Record<string, string>;
    readonly label: string;
    readonly timeoutMs: number;
    readonly schema: z.ZodType<T>;
    readonly signal?: AbortSignal;
    readonly maxResponseBytes?: number;
  }
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const composite = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    method: "POST",
    signal: composite,
  });

  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  await ensureOk(response, options.label, maxResponseBytes);

  const text = await readResponseText(response, maxResponseBytes);
  const json: unknown = JSON.parse(text);
  return options.schema.parse(json);
}

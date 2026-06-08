import { z } from "zod";
import { readApiKeyPool } from "../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createBasicAuthHeader as createSharedBasicAuthHeader,
  getBaseUrl as getSharedBaseUrl,
  requireTrustedProviderBaseUrl as requireSharedTrustedProviderBaseUrl,
} from "../providers/shared/base-url.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { getErrorMessage, SearchEngineError } from "./errors.ts";
import {
  fetchSearchText,
  parseJsonResponse,
  REQUEST_TIMEOUT_MS,
  unknownRecordSchema,
} from "./http.ts";
import { attachEngine, dedupeResults, normalizeResult } from "./text.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
} from "./types.ts";

export interface JsonProviderRequest {
  readonly authFailureStatuses?: ReadonlySet<number>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly method: "GET" | "POST";
  readonly url: string;
}

export interface JsonProviderSpec {
  buildRequest(query: string, numResults: number): JsonProviderRequest;
  readonly name: SearchEngineName;
  parse(payload: unknown): ParsedResult[];
}

const OPTIONAL_STRING_SCHEMA = z.string().nullable().optional();

const COMMON_RESULT_SCHEMA = z.object({
  content: OPTIONAL_STRING_SCHEMA,
  description: OPTIONAL_STRING_SCHEMA,
  desc: OPTIONAL_STRING_SCHEMA,
  excerpts: z
    .union([z.array(z.string()), z.string()])
    .nullable()
    .optional(),
  link: OPTIONAL_STRING_SCHEMA,
  name: OPTIONAL_STRING_SCHEMA,
  snippet: OPTIONAL_STRING_SCHEMA,
  title: OPTIONAL_STRING_SCHEMA,
  url: OPTIONAL_STRING_SCHEMA,
});

export type CommonResult = z.infer<typeof COMMON_RESULT_SCHEMA>;

export function createJsonSearchProvider(
  spec: JsonProviderSpec
): SearchProvider {
  return {
    name: spec.name,
    async search(query: string, numResults: number) {
      try {
        const request = spec.buildRequest(query, numResults);
        const responseBody = await fetchSearchText({
          authFailureStatuses: request.authFailureStatuses,
          engine: spec.name,
          init: {
            body:
              request.body === undefined
                ? undefined
                : JSON.stringify(request.body),
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "User-Agent": getRandomUserAgent(),
              ...request.headers,
            },
            method: request.method,
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
          url: request.url,
        });
        const results = dedupeResults(
          spec.parse(parseJsonResponse(responseBody, spec.name))
        ).slice(0, numResults);

        if (results.length === 0) {
          throw new SearchEngineError(spec.name, "no-results", "No Results");
        }

        return attachEngine(spec.name, results);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          throw error;
        }

        throw new SearchEngineError(
          spec.name,
          "transient",
          `${spec.name} search failed: ${getErrorMessage(error)}`
        );
      }
    },
  };
}

export function getEnvPool(
  name: string,
  env: EnvironmentReader = processEnvironmentReader
): readonly string[] {
  return readApiKeyPool(name, env);
}

export function getEnvPair(
  firstName: string,
  secondName: string,
  env: EnvironmentReader = processEnvironmentReader
): readonly [string, string] | null {
  const firstValue = env.read(firstName)?.trim();
  const secondValue = env.read(secondName)?.trim();

  if (!(firstValue && secondValue)) {
    return null;
  }

  return [firstValue, secondValue];
}

export function parseCommonResultArray(
  payload: unknown,
  path: readonly string[]
): ParsedResult[] {
  const candidate = getPathValue(payload, path);
  const parsed = z.array(COMMON_RESULT_SCHEMA).safeParse(candidate);
  if (!parsed.success) {
    return [];
  }

  return parsed.data
    .map((item) => {
      const excerpts = Array.isArray(item.excerpts)
        ? item.excerpts.join(" ")
        : item.excerpts;

      return normalizeResult({
        snippet:
          item.snippet ??
          item.description ??
          item.desc ??
          item.content ??
          excerpts ??
          "",
        title: item.title ?? item.name ?? item.url ?? item.link ?? "",
        url: item.url ?? item.link ?? "",
      });
    })
    .filter((result): result is ParsedResult => result !== null);
}

export function getPathValue(
  payload: unknown,
  path: readonly string[]
): unknown {
  let current: unknown = payload;

  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) {
        return;
      }
      current = current[index];
      continue;
    }

    const parsed = unknownRecordSchema.safeParse(current);
    if (!parsed.success) {
      return;
    }
    current = parsed.data[segment];
  }

  return current;
}

export function parseArrayFromAnyPath(
  payload: unknown,
  paths: readonly (readonly string[])[]
): ParsedResult[] {
  for (const path of paths) {
    const results = parseCommonResultArray(payload, path);
    if (results.length > 0) {
      return results;
    }
  }

  return [];
}

export function getBaseUrl(
  envName: string,
  defaultBaseUrl: string,
  env: EnvironmentReader = processEnvironmentReader
): string {
  return getSharedBaseUrl(envName, defaultBaseUrl, env);
}

export function requireTrustedProviderBaseUrl(
  envName: string,
  baseUrl: string
): string {
  return requireSharedTrustedProviderBaseUrl(envName, baseUrl);
}

export function createBasicAuthHeader(
  username: string,
  password: string
): string {
  return createSharedBasicAuthHeader(username, password);
}

import { getFailureKind } from "../observability.ts";
import {
  assertFallbackAllowed,
  emitFetchFallback,
  type FetchPipelineContext,
  firstConfiguredFetchProvider,
  observeFetchProvider,
} from "./provider-context.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export function tryFetchUrlViaExaMcp(
  url: string,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult | null> {
  const provider = context.exaMcpFetchProvider;
  if (!provider?.isEnabled(context.env)) {
    return Promise.resolve(null);
  }
  return observeFetchProvider(context, operationId, "exa-mcp", () =>
    provider.fetchUrl(url, context.env)
  );
}

export async function tryFetchUrlsViaExaMcp(
  urls: string[],
  maxCharacters: number,
  context: FetchPipelineContext,
  operationId: string
): Promise<FetchResult[] | null> {
  const provider = context.exaMcpFetchProvider;
  if (!provider?.isEnabled(context.env)) {
    return null;
  }

  try {
    return await observeFetchProvider(
      context,
      operationId,
      "exa-mcp",
      async () => {
        const results = await provider.fetchBatch(
          urls,
          maxCharacters,
          context.env
        );
        return urls.map((url, index) => {
          const result =
            results.find((candidate) => candidate.url === url) ??
            results[index];
          if (!result) {
            throw new Error(
              "Exa MCP fetch returned an unexpected response shape"
            );
          }
          return createFetchResult(url, result.content, result.title);
        });
      }
    );
  } catch (error) {
    assertFallbackAllowed(error);
    emitFetchFallback(
      context,
      operationId,
      "exa-mcp",
      firstConfiguredFetchProvider(context),
      getFailureKind(error)
    );
    return null;
  }
}

import { SearchEngineError, TerminalSearchError } from "./errors.ts";
import {
  type ParsedResult,
  type SearchEngineName,
  type SearchProvider,
  searchResultSchema,
} from "./types.ts";

const DEFAULT_NATIVE_SEARCH_TIMEOUT_MS = 8000;

export interface NativeSearchRouteOptions {
  readonly signal: AbortSignal;
}

export interface NativeSearchRoute {
  readonly engine: SearchEngineName;
  /** Stable, non-secret identity used to de-duplicate one provider endpoint. */
  readonly id: string;
  readonly search: (
    query: string,
    numResults: number,
    options: NativeSearchRouteOptions
  ) => Promise<readonly ParsedResult[]>;
  /** Per-attempt deadline. Defaults to 8 seconds. */
  readonly timeoutMs?: number;
}

export interface NativeSearchRouteSnapshot {
  /** The active model/session route. It is always attempted first. */
  readonly active?: NativeSearchRoute;
  /** Other currently available subscription routes, in fallback order. */
  readonly available: readonly NativeSearchRoute[];
}

export interface NativeSearchRegistry {
  /**
   * Resolve routes from the host coding agent's current credential/session
   * state. Credential material should stay captured inside each route's
   * `search` function and must not be returned in route metadata.
   */
  readonly resolve: () =>
    | NativeSearchRouteSnapshot
    | Promise<NativeSearchRouteSnapshot>;
}

export async function resolveNativeSearchProviders(
  registry: NativeSearchRegistry
): Promise<SearchProvider[]> {
  let snapshot: NativeSearchRouteSnapshot;
  try {
    snapshot = await registry.resolve();
  } catch (error) {
    if (!(error instanceof SearchEngineError)) {
      const terminalError = new TerminalSearchError(error);
      throw terminalError;
    }
    return [
      {
        name: error.engine,
        search: () => Promise.reject(error),
      },
    ];
  }
  const routes = snapshot.active
    ? [snapshot.active, ...snapshot.available]
    : snapshot.available;
  const seenRouteIds = new Set<string>();
  const providers: SearchProvider[] = [];

  for (const route of routes) {
    if (seenRouteIds.has(route.id)) {
      continue;
    }
    seenRouteIds.add(route.id);
    providers.push({
      name: route.engine,
      search: async (query, numResults) => {
        try {
          return await executeNativeSearchRoute(route, query, numResults);
        } catch (error) {
          if (error instanceof SearchEngineError) {
            throw error;
          }
          const terminalError = new TerminalSearchError(error);
          throw terminalError;
        }
      },
    });
  }

  return providers;
}

async function executeNativeSearchRoute(
  route: NativeSearchRoute,
  query: string,
  numResults: number
) {
  const timeoutMs = route.timeoutMs ?? DEFAULT_NATIVE_SEARCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Native search route timeoutMs must be positive");
  }

  const abortController = new AbortController();
  const timeoutError = new SearchEngineError(
    route.engine,
    "transient",
    `${route.engine} native search timed out after ${timeoutMs}ms`
  );
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      abortController.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const results = await Promise.race([
      route.search(query, numResults, { signal: abortController.signal }),
      timeoutPromise,
    ]);
    const normalizedResults = results.map((result) =>
      searchResultSchema.parse({ ...result, engine: route.engine })
    );
    if (normalizedResults.length === 0) {
      throw new SearchEngineError(
        route.engine,
        "no-results",
        `${route.engine} search returned no results`
      );
    }
    return normalizedResults;
  } catch (error) {
    if (didTimeout) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

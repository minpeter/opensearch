import { TtlCache } from "../cache.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  createOpenSearchObserver,
  emitCacheEvent,
  type OpenSearchObserver,
  observeOperation,
  observeProviderAttempt,
} from "../observability.ts";
import { searchExaCodeContext } from "./providers/exa-code.ts";
import { searchGitHubCode } from "./providers/github.ts";
import { searchGrepMcp } from "./providers/grep-mcp.ts";
import { searchSourcegraphCode } from "./providers/sourcegraph.ts";
import type {
  CodeSearchOptions,
  CodeSearchProvider,
  CodeSearchProviderName,
  CodeSearchResult,
  CodeSearchService,
  CodeSearchServiceOptions,
} from "./types.ts";

const CODE_CACHE_TTL_MS = 3 * 60 * 1000;
const CODE_CACHE_MAX_ENTRIES = 256;
const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 30;
const FORGE_HOST_PREFIX_REGEX =
  /^(?:bitbucket\.org|codeberg\.org|gitee\.com|github\.com|gitlab\.com)\//u;

export class CodeSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeSearchConfigurationError";
  }
}

export class CodeSearchExecutionError extends Error {
  readonly failures: readonly Error[];

  constructor(failures: readonly Error[]) {
    super(
      `Search failed across all engines: ${failures
        .map((failure) => failure.message)
        .join(" | ")}`
    );
    this.name = "CodeSearchExecutionError";
    this.failures = failures;
  }
}

interface ConfiguredCodeSearchService extends CodeSearchService {
  readonly providerNames: readonly string[];
}

export function createCodeSearchService(
  env: EnvironmentReader = processEnvironmentReader,
  options: CodeSearchServiceOptions & { observer?: OpenSearchObserver } = {}
): ConfiguredCodeSearchService {
  const observer = options.observer ?? createOpenSearchObserver();
  const cache =
    options.cache?.enabled === false
      ? null
      : new TtlCache<string, CodeSearchResult[]>(
          options.cache?.ttlMs ?? CODE_CACHE_TTL_MS,
          { maxEntries: options.cache?.maxEntries ?? CODE_CACHE_MAX_ENTRIES }
        );
  const providers = options.providers ?? defaultProviders(env, options);

  function executeCodeSearch(
    query: string,
    callOptions: CodeSearchOptions = {}
  ): Promise<CodeSearchResult[]> {
    return observeOperation(
      observer,
      { inputCount: 1, operation: "code_search" },
      (operationId) => {
        const normalizedOptions = normalizeOptions(callOptions);
        const cacheKey = JSON.stringify([
          query,
          normalizedOptions.language ?? "",
          normalizedOptions.numResults,
          normalizedOptions.path ?? "",
          normalizedOptions.repo ?? "",
          normalizedOptions.sources ?? [],
          normalizedOptions.useRegexp ?? false,
        ]);
        const execute = async () =>
          fanOutProviders(query, normalizedOptions, operationId);
        if (cache === null || normalizedOptions.cache === "bypass") {
          emitCacheEvent(observer, "code_search", operationId, "bypass");
          return execute();
        }
        const cacheHit = cache.has(cacheKey);
        emitCacheEvent(
          observer,
          "code_search",
          operationId,
          cacheHit ? "hit" : "miss"
        );
        return cache.getOrSet(cacheKey, execute);
      },
      (results) => results.length
    );
  }

  async function fanOutProviders(
    query: string,
    callOptions: CodeSearchOptions,
    operationId: string
  ): Promise<CodeSearchResult[]> {
    const failures: Error[] = [];
    const limit = callOptions.numResults ?? DEFAULT_NUM_RESULTS;
    assertRequestedProvidersAvailable(providers, callOptions);
    const active = providers.filter((provider) =>
      providerEnabled(provider.name, callOptions)
    );
    assertCompatibleProviders(active, callOptions);

    const settled = await Promise.all(
      active.map(async (provider) => {
        try {
          return await observeProviderAttempt(
            observer,
            { operation: "code_search", operationId, provider: provider.name },
            () => provider.search(query, callOptions)
          );
        } catch (error) {
          failures.push(sanitizeProviderFailure(provider.name, error));
          return [] as CodeSearchResult[];
        }
      })
    );

    const merged = mergeResults(interleaveProviderResults(settled));
    if (merged.length === 0 && failures.length === active.length) {
      throw new CodeSearchExecutionError(failures);
    }
    return merged.slice(0, limit);
  }

  return {
    codeSearch: executeCodeSearch,
    providerNames: providers.map((p) => p.name),
  };
}

const defaultCodeSearchService = createCodeSearchService(
  processEnvironmentReader
);

export function codeSearch(
  query: string,
  options?: CodeSearchOptions
): Promise<CodeSearchResult[]> {
  return defaultCodeSearchService.codeSearch(query, options);
}

function normalizeOptions(options: CodeSearchOptions): CodeSearchOptions {
  const requested = options.numResults ?? DEFAULT_NUM_RESULTS;
  const safe = Number.isFinite(requested)
    ? Math.trunc(requested)
    : DEFAULT_NUM_RESULTS;
  return {
    ...options,
    numResults: Math.min(MAX_NUM_RESULTS, Math.max(1, safe)),
  };
}

function sanitizeProviderFailure(
  provider: CodeSearchProviderName,
  error: unknown
): Error {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? ` (HTTP ${error.status})`
      : "";
  return new Error(`${provider} code search failed${status}`);
}

function defaultProviders(
  env: EnvironmentReader,
  options: CodeSearchServiceOptions
): readonly CodeSearchProvider[] {
  const githubToken =
    options.githubToken ?? env.read("GITHUB_TOKEN") ?? env.read("GH_TOKEN");
  const sourcegraphToken =
    options.sourcegraphToken ?? env.read("SOURCEGRAPH_TOKEN");

  const providers: CodeSearchProvider[] = [
    { name: "grep", search: (query, opts) => searchGrepMcp(query, opts) },
    {
      name: "exa-code",
      search: (query, opts) => searchExaCodeContext(query, opts),
    },
    {
      name: "sourcegraph",
      search: (query, opts) =>
        searchSourcegraphCode(query, opts, sourcegraphToken),
    },
  ];
  if (githubToken) {
    providers.push({
      name: "github",
      search: (query, opts) => searchGitHubCode(query, githubToken, opts),
    });
  }
  return providers;
}

function assertRequestedProvidersAvailable(
  providers: readonly CodeSearchProvider[],
  options: CodeSearchOptions
): void {
  if (!options.sources) {
    return;
  }
  const configured = new Set(providers.map((provider) => provider.name));
  const missing = options.sources.filter((source) => !configured.has(source));
  if (missing.includes("github")) {
    throw new CodeSearchConfigurationError(
      "GitHub code search requires a token (GITHUB_TOKEN, GH_TOKEN, or an explicit githubToken option)"
    );
  }
  if (missing.length > 0) {
    throw new CodeSearchConfigurationError(
      `Code search providers are not configured: ${missing.join(", ")}`
    );
  }
}

function assertCompatibleProviders(
  active: readonly CodeSearchProvider[],
  options: CodeSearchOptions
): void {
  if (active.length > 0) {
    return;
  }
  if (options.sources?.includes("exa-code") && (options.repo || options.path)) {
    throw new CodeSearchConfigurationError(
      "Exa Code does not support repository or path filters"
    );
  }
  throw new CodeSearchConfigurationError(
    "No configured code search provider supports these filters"
  );
}

function providerEnabled(
  name: CodeSearchProviderName,
  options: CodeSearchOptions
): boolean {
  if (options.sources && !options.sources.includes(name)) {
    return false;
  }
  if (
    name === "exa-code" &&
    (options.useRegexp || options.repo || options.path)
  ) {
    return false;
  }
  return true;
}

function interleaveProviderResults(
  groups: readonly CodeSearchResult[][]
): CodeSearchResult[] {
  const interleaved: CodeSearchResult[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (result) {
        interleaved.push(result);
      }
    }
  }
  return interleaved;
}

function mergeResults(results: CodeSearchResult[]): CodeSearchResult[] {
  const byFile = new Map<
    string,
    CodeSearchResult & {
      matches: { snippet: string; lineEnd?: number; lineStart?: number }[];
    }
  >();
  for (const result of results) {
    const key = `${normalizeRepoIdentity(result.repo)}/${result.path}`;
    const existing = byFile.get(key);
    if (existing) {
      for (const match of result.matches) {
        if (!existing.matches.some((seen) => seen.snippet === match.snippet)) {
          existing.matches.push(match);
        }
      }
    } else {
      byFile.set(key, { ...result, matches: [...result.matches] });
    }
  }
  return [...byFile.values()];
}

function normalizeRepoIdentity(repo: string): string {
  return repo.replace(FORGE_HOST_PREFIX_REGEX, "");
}

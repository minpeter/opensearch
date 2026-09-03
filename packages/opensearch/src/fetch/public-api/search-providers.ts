import type { FetchResult } from "../result.ts";
import type { PublicApiRoute } from "./registry.ts";
import {
  fetchKnowledgeSearchProvider,
  isKnowledgeSearchProvider,
} from "./search-providers/knowledge.ts";
import {
  fetchPackageSearchProvider,
  isPackageSearchProvider,
} from "./search-providers/packages.ts";
import {
  fetchStackExchangeSearchProvider,
  isStackExchangeSearchProvider,
} from "./search-providers/stack-exchange.ts";

function isSearchProvider(url: URL): boolean {
  return (
    isPackageSearchProvider(url) ||
    isKnowledgeSearchProvider(url) ||
    isStackExchangeSearchProvider(url)
  );
}

function fetchSearchProvider(
  url: URL,
  signal?: AbortSignal
): Promise<FetchResult | null> {
  if (isPackageSearchProvider(url)) {
    return fetchPackageSearchProvider(url, signal);
  }
  if (isKnowledgeSearchProvider(url)) {
    return fetchKnowledgeSearchProvider(url, signal);
  }
  if (isStackExchangeSearchProvider(url)) {
    return fetchStackExchangeSearchProvider(url, signal);
  }
  return Promise.resolve(null);
}

export const searchProvidersPublicApiRoute = {
  fetch: fetchSearchProvider,
  match: isSearchProvider,
  name: "search-providers",
} satisfies PublicApiRoute;

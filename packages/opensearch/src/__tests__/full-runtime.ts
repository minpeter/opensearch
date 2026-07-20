import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import { exaMcpFetchProvider } from "../fetch/exa-mcp-provider.ts";
import { fetchLocalUrl } from "../fetch/local.ts";
import { createFetchService } from "../fetch.ts";
import { createDuckDuckGoProvider } from "../search/duckduckgo.ts";
import { createExaMcpSearchProvider } from "../search/providers/exa-mcp.ts";
import { createParallelMcpSearchProvider } from "../search/providers/parallel-mcp.ts";
import { getSearchProviders } from "../search/providers.ts";
import { createSearchService } from "../search.ts";

const fetchService = createFetchService(processEnvironmentReader, {
  exaMcpFetchProvider,
  localFetch: fetchLocalUrl,
});

const searchService = createSearchService(processEnvironmentReader, {
  providers: (env: EnvironmentReader) =>
    getSearchProviders(env, {
      duckDuckGoFactory: createDuckDuckGoProvider,
      exaMcpFactory: createExaMcpSearchProvider,
      parallelMcpFactory: createParallelMcpSearchProvider,
    }),
});

export const { fetchUrl, fetchUrls, fetchUrlWithCache, fetchUrlsWithCache } =
  fetchService;
export const { search, searchWithRetryAndCache } = searchService;

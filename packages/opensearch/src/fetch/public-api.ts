import { blueskyPublicApiRoute } from "./public-api/bluesky.ts";
import { communityProvidersPublicApiRoute } from "./public-api/community-providers.ts";
import { hackerNewsPublicApiRoute } from "./public-api/hacker-news.ts";
import { knowledgeProvidersPublicApiRoute } from "./public-api/knowledge-providers.ts";
import { mastodonPublicApiRoute } from "./public-api/mastodon.ts";
import { redditPublicApiRoute } from "./public-api/reddit.ts";
import { createPublicApiRouter } from "./public-api/registry.ts";
import { registryProvidersPublicApiRoute } from "./public-api/registry-providers.ts";
import { searchProvidersPublicApiRoute } from "./public-api/search-providers.ts";
import { stackExchangePublicApiRoute } from "./public-api/stack-exchange.ts";
import { xTwitterPublicApiRoute } from "./public-api/x-twitter.ts";

export const fetchViaPublicApi = createPublicApiRouter([
  redditPublicApiRoute,
  searchProvidersPublicApiRoute,
  hackerNewsPublicApiRoute,
  xTwitterPublicApiRoute,
  blueskyPublicApiRoute,
  mastodonPublicApiRoute,
  stackExchangePublicApiRoute,
  registryProvidersPublicApiRoute,
  knowledgeProvidersPublicApiRoute,
  communityProvidersPublicApiRoute,
]);

import type { FetchResult } from "../result.ts";

export interface PublicApiRoute {
  readonly fetch: (url: URL) => Promise<FetchResult | null>;
  readonly match: (url: URL) => boolean;
  readonly name: string;
}

export type PublicApiRouter = (rawUrl: string) => Promise<FetchResult | null>;

export function createPublicApiRouter(
  routes: readonly PublicApiRoute[]
): PublicApiRouter {
  return (rawUrl) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return Promise.resolve(null);
    }

    for (const route of routes) {
      if (route.match(url)) {
        return route.fetch(url);
      }
    }

    return Promise.resolve(null);
  };
}

import type { FetchResult } from "../result.ts";

export interface PublicApiRoute {
  readonly fetch: (
    url: URL,
    signal?: AbortSignal
  ) => Promise<FetchResult | null>;
  readonly match: (url: URL) => boolean;
  readonly name: string;
}

export type PublicApiRouter = (
  rawUrl: string,
  signal?: AbortSignal
) => Promise<FetchResult | null>;

export function createPublicApiRouter(
  routes: readonly PublicApiRoute[]
): PublicApiRouter {
  return (rawUrl, signal) =>
    Promise.resolve().then(() => {
      signal?.throwIfAborted();
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return null;
      }

      for (const route of routes) {
        if (route.match(url)) {
          return route.fetch(url, signal);
        }
      }

      return null;
    });
}

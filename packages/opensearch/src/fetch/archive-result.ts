import { fetchArchiveFallback } from "./cache-archive.ts";
import type { FetchResult } from "./result.ts";

type ResponseParser = (
  url: string,
  response: Response
) => Promise<FetchResult | null>;
type ResponseFetcher = (url: string) => Promise<Response>;

export async function fetchViaArchiveFallback(
  url: string,
  parseResponse: ResponseParser,
  fetcher: ResponseFetcher = fetch
): Promise<FetchResult | null> {
  const archived = await fetchArchiveFallback(url, fetcher);
  if (!archived) {
    return null;
  }
  return parseResponse(url, archived.response);
}

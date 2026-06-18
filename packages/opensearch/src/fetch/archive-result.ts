import { fetchArchiveFallback } from "./cache-archive.ts";
import type { FetchResult } from "./result.ts";

type ResponseParser = (
  url: string,
  response: Response
) => Promise<FetchResult | null>;

export async function fetchViaArchiveFallback(
  url: string,
  parseResponse: ResponseParser
): Promise<FetchResult | null> {
  const archived = await fetchArchiveFallback(url);
  if (!archived) {
    return null;
  }
  return parseResponse(url, archived.response);
}

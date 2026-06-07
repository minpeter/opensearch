import { z } from "zod";

export const fetchResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  length: z.number(),
});

export type FetchResult = z.infer<typeof fetchResultSchema>;

export function createFetchResult(
  url: string,
  content: string,
  title = ""
): FetchResult {
  return {
    title,
    content,
    url,
    length: content.length,
  };
}

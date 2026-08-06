export const MAX_PROVIDER_SNIPPET_LENGTH = 280;

export interface ProviderResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export function attachProviderEngine<
  TEngine extends string,
  TResult extends ProviderResult,
>(
  engine: TEngine,
  results: readonly TResult[]
): Array<TResult & { engine: TEngine }> {
  return results.map((result) => ({ ...result, engine }));
}

export function cleanProviderText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateProviderText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncatedText = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = truncatedText.lastIndexOf(" ");

  if (lastSpaceIndex <= maxLength / 2) {
    return `${truncatedText}...`;
  }

  return `${truncatedText.slice(0, lastSpaceIndex)}...`;
}

export function normalizeProviderResult(
  result: ProviderResult
): ProviderResult | null {
  const title = cleanProviderText(result.title);
  if (!title) {
    return null;
  }

  const url = result.url.trim();
  if (!url) {
    return null;
  }

  const snippet = truncateProviderText(
    cleanProviderText(result.snippet),
    MAX_PROVIDER_SNIPPET_LENGTH
  );
  if (!snippet) {
    return null;
  }

  return { snippet, title, url };
}

export function dedupeProviderResults<T extends ProviderResult>(
  results: readonly T[]
): T[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

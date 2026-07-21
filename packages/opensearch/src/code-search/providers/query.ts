const BACKSLASH_REGEX = /\\/gu;
const DOUBLE_QUOTE_REGEX = /"/gu;
const FORWARD_SLASH_REGEX = /\//gu;

export function formatSearchPattern(
  query: string,
  useRegexp: boolean | undefined
): string {
  if (useRegexp) {
    const escaped = query
      .replace(BACKSLASH_REGEX, "\\\\")
      .replace(FORWARD_SLASH_REGEX, "\\/");
    return `/${escaped}/`;
  }
  return quoteSearchValue(query);
}

export function quoteSearchValue(value: string): string {
  const escaped = value
    .replace(BACKSLASH_REGEX, "\\\\")
    .replace(DOUBLE_QUOTE_REGEX, '\\"');
  return `"${escaped}"`;
}

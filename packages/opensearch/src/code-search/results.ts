import type { CodeSearchResult } from "./types.ts";

const FORGE_HOST_PREFIX_REGEX =
  /^(?:bitbucket\.org|codeberg\.org|gitee\.com|github\.com|gitlab\.com)\//u;

export function interleaveProviderResults(
  groups: readonly CodeSearchResult[][]
): CodeSearchResult[] {
  const interleaved: CodeSearchResult[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (result) {
        interleaved.push(result);
      }
    }
  }
  return interleaved;
}

export function mergeResults(results: CodeSearchResult[]): CodeSearchResult[] {
  const byFile = new Map<
    string,
    CodeSearchResult & {
      matches: { snippet: string; lineEnd?: number; lineStart?: number }[];
    }
  >();
  for (const result of results) {
    const key = `${normalizeRepoIdentity(result.repo)}/${result.path}`;
    const existing = byFile.get(key);
    if (existing) {
      for (const match of result.matches) {
        if (!existing.matches.some((seen) => seen.snippet === match.snippet)) {
          existing.matches.push(match);
        }
      }
    } else {
      byFile.set(key, { ...result, matches: [...result.matches] });
    }
  }
  return [...byFile.values()];
}

function normalizeRepoIdentity(repo: string): string {
  return repo.replace(FORGE_HOST_PREFIX_REGEX, "");
}

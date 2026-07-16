import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAX_ROUTING_TEST_PURE_LOC = 250;
const MAX_SERP_PROVIDER_PURE_LOC = 120;
const MAX_SERP_REGISTRY_PURE_LOC = 80;
const LINE_BREAK_REGEX = /\r?\n/;
const LEGACY_PROVIDER_FILE_REGEX = /^providers-.+\.ts$/u;
const SEARCH_MODULE_IMPORT_REGEX = /from\s+["'](?:\.\.\/)+search\//u;
const DIRECT_RESPONSE_BODY_READ_REGEX =
  /\bresponse\.(?:arrayBuffer|blob|json|text)\s*\(/u;
const SOURCE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const TESTS_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const EXPECTED_SEARCH_PROVIDER_REGISTRY_FILES = [
  "core.ts",
  "exa-mcp.ts",
  "exa.ts",
  "firecrawl.ts",
  "independent.ts",
  "jina.ts",
  "llm.ts",
  "ollama.ts",
  "parallel-mcp.ts",
  "serp.ts",
] as const;
const EXPECTED_SERP_PROVIDER_FILES = [
  "bright-data.ts",
  "dataforseo.ts",
  "google-custom-search.ts",
  "scrapingbee.ts",
  "searchapi.ts",
  "serpapi.ts",
  "serper.ts",
] as const;
const EXPECTED_TINYFISH_PROVIDER_FILES = [
  "api-key-pool.ts",
  "fetch.ts",
  "http.ts",
  "search.ts",
] as const;
const EXPECTED_EXA_MCP_PROVIDER_FILES = ["client.ts", "content.ts"] as const;
const EXPECTED_FIRECRAWL_PROVIDER_FILES = ["client.ts"] as const;
const EXPECTED_PARALLEL_MCP_PROVIDER_FILES = [
  "client.ts",
  "content.ts",
] as const;
const LEGACY_ROOT_PROVIDER_FILES = [
  "exa-mcp-provider.ts",
  "exa-mcp.ts",
  "parallel-mcp-provider.ts",
  "parallel-mcp.ts",
] as const;
const ALLOWED_DIRECT_RESPONSE_BODY_READ_FILES = new Set([
  "node/tls-executor.ts",
]);

describe("test structure", () => {
  it("keeps routing test files below the pure LOC ceiling", () => {
    const oversizedRoutingTests = readdirSync(TESTS_DIRECTORY)
      .filter((fileName) => fileName.endsWith("routing.test.ts"))
      .map((fileName) => ({
        fileName,
        pureLoc: countPureLoc(
          readFileSync(join(TESTS_DIRECTORY, fileName), "utf8")
        ),
      }))
      .filter(({ pureLoc }) => pureLoc > MAX_ROUTING_TEST_PURE_LOC);

    expect(oversizedRoutingTests).toEqual([]);
  });

  it("keeps provider implementation registries under provider folders", () => {
    const searchDirectory = join(SOURCE_DIRECTORY, "search");
    const searchProviderDirectory = join(searchDirectory, "providers");
    const commonProviderDirectory = join(SOURCE_DIRECTORY, "providers");

    expect(listTsFiles(searchProviderDirectory)).toEqual([
      ...EXPECTED_SEARCH_PROVIDER_REGISTRY_FILES,
    ]);
    expect(listTsFiles(join(commonProviderDirectory, "tinyfish"))).toEqual([
      ...EXPECTED_TINYFISH_PROVIDER_FILES,
    ]);
    expect(listTsFiles(searchDirectory).filter(isLegacyProviderFile)).toEqual(
      []
    );
    expect(listTsFiles(join(commonProviderDirectory, "exa-mcp"))).toEqual([
      ...EXPECTED_EXA_MCP_PROVIDER_FILES,
    ]);
    expect(listTsFiles(join(commonProviderDirectory, "firecrawl"))).toEqual([
      ...EXPECTED_FIRECRAWL_PROVIDER_FILES,
    ]);
    expect(listTsFiles(join(commonProviderDirectory, "parallel-mcp"))).toEqual([
      ...EXPECTED_PARALLEL_MCP_PROVIDER_FILES,
    ]);
    expect(findExistingRootFiles(LEGACY_ROOT_PROVIDER_FILES)).toEqual([]);
    expect(existsSync(join(SOURCE_DIRECTORY, "tinyfish"))).toBe(false);
  });

  it("keeps common providers independent from search modules", () => {
    const providerDirectory = join(SOURCE_DIRECTORY, "providers");
    const searchCoupledProviderFiles = listTsFilesRecursive(providerDirectory)
      .filter((filePath) =>
        SEARCH_MODULE_IMPORT_REGEX.test(readFileSync(filePath, "utf8"))
      )
      .map((filePath) => filePath.slice(providerDirectory.length + 1));

    expect(searchCoupledProviderFiles).toEqual([]);
  });

  it("keeps external response reads behind the bounded body reader", () => {
    const directReaders = listTsFilesRecursive(SOURCE_DIRECTORY)
      .map((filePath) => relative(SOURCE_DIRECTORY, filePath))
      .filter((filePath) => !filePath.startsWith("__tests__/"))
      .filter(
        (filePath) =>
          !ALLOWED_DIRECT_RESPONSE_BODY_READ_FILES.has(filePath) &&
          DIRECT_RESPONSE_BODY_READ_REGEX.test(
            readFileSync(join(SOURCE_DIRECTORY, filePath), "utf8")
          )
      );

    expect(directReaders).toEqual([]);
  });

  it("keeps SERP providers in small dedicated files", () => {
    const serpProviderDirectory = join(
      SOURCE_DIRECTORY,
      "search",
      "providers",
      "serp"
    );
    const providerFiles = listTsFiles(serpProviderDirectory);

    expect(providerFiles).toEqual([...EXPECTED_SERP_PROVIDER_FILES]);

    const oversizedProviderFiles = providerFiles
      .map((fileName) => ({
        fileName,
        pureLoc: countPureLoc(
          readFileSync(join(serpProviderDirectory, fileName), "utf8")
        ),
      }))
      .filter(({ pureLoc }) => pureLoc > MAX_SERP_PROVIDER_PURE_LOC);

    expect(oversizedProviderFiles).toEqual([]);
  });

  it("keeps the SERP provider registry as a thin composition layer", () => {
    const registrySource = readFileSync(
      join(SOURCE_DIRECTORY, "search", "providers", "serp.ts"),
      "utf8"
    );

    expect(countPureLoc(registrySource)).toBeLessThanOrEqual(
      MAX_SERP_REGISTRY_PURE_LOC
    );
  });
});

function countPureLoc(source: string): number {
  return source.split(LINE_BREAK_REGEX).filter(isPureCodeLine).length;
}

function listTsFiles(directory: string): string[] {
  return existsSync(directory)
    ? readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".ts"))
        .sort()
    : [];
}

function listTsFilesRecursive(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listTsFilesRecursive(entryPath);
      }

      return entry.name.endsWith(".ts") ? [entryPath] : [];
    })
    .sort();
}

function isLegacyProviderFile(fileName: string): boolean {
  return LEGACY_PROVIDER_FILE_REGEX.test(fileName);
}

function findExistingRootFiles(fileNames: readonly string[]): string[] {
  return fileNames.filter((fileName) =>
    existsSync(join(SOURCE_DIRECTORY, fileName))
  );
}

function isPureCodeLine(line: string): boolean {
  const trimmedLine = line.trim();
  return trimmedLine.length > 0 && !trimmedLine.startsWith("//");
}

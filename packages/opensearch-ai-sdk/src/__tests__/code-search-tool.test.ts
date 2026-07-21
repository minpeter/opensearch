import {
  CODE_SEARCH_PROVIDER_NAMES as CORE_CODE_SEARCH_PROVIDER_NAMES,
  codeSearchResultsSchema as coreCodeSearchResultsSchema,
} from "@minpeter/opensearch";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createCodeSearchTool, createOpenSearchTools } from "../node.ts";
import {
  CODE_SEARCH_PROVIDER_NAMES,
  codeSearchInputSchema,
  codeSearchOutputSchema,
} from "../tool-schemas.ts";

const executionOptions = {} as ToolExecutionOptions<unknown>;

const codeResult = {
  matches: [{ lineStart: 12, snippet: "isError: true" }],
  path: "src/tool.ts",
  provider: "grep" as const,
  repo: "owner/repo",
  url: "https://github.com/owner/repo/blob/main/src/tool.ts",
};

function fakeClient() {
  return {
    codeSearch: vi.fn().mockResolvedValue([codeResult]),
    fetch: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    searchStream: vi.fn(),
  };
}

describe("code_search AI SDK tool", () => {
  it("keeps provider names and output parsing aligned with the core", () => {
    expect(CODE_SEARCH_PROVIDER_NAMES).toEqual(CORE_CODE_SEARCH_PROVIDER_NAMES);
    expect(codeSearchOutputSchema.parse([codeResult])).toEqual(
      coreCodeSearchResultsSchema.parse([codeResult])
    );
  });

  it("exposes provider-neutral input and file-grouped output schemas", () => {
    expect(
      codeSearchInputSchema.parse({
        language: "TypeScript",
        numResults: 5,
        query: "isError",
        sources: ["github", "grep"],
      })
    ).toMatchObject({ query: "isError" });
    expect(codeSearchOutputSchema.parse([codeResult])).toEqual([codeResult]);
  });

  it("routes normalized filters to client.codeSearch", async () => {
    const client = fakeClient();
    const tool = createCodeSearchTool({ client });

    await expect(
      tool.execute(
        {
          language: "TypeScript",
          numResults: 5,
          path: "src/",
          query: "isError",
          repo: "owner/repo",
          sources: ["github", "grep"],
          useRegexp: false,
        },
        executionOptions
      )
    ).resolves.toEqual([codeResult]);
    expect(client.codeSearch).toHaveBeenCalledWith("isError", {
      language: "TypeScript",
      numResults: 5,
      path: "src/",
      repo: "owner/repo",
      sources: ["github", "grep"],
      useRegexp: false,
    });
  });

  it("includes code_search in the complete tool set", () => {
    const tools = createOpenSearchTools({ client: fakeClient() });

    expect(Object.keys(tools)).toEqual([
      "web_search",
      "web_fetch",
      "code_search",
    ]);
  });
});

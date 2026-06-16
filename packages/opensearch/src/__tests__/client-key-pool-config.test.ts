import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenSearch } from "../index.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

const DISABLE_HOSTED_ENV = {
  OPENSEARCH_ENABLE_EXA_MCP: "false",
  OPENSEARCH_ENABLE_FIRECRAWL: "false",
  OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
} as const;

describe("createOpenSearch API key pool config", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("keeps generic provider API key pools isolated per explicit client", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      createMockJsonResponse({
        results: [
          {
            content: "Tavily explicit client key pool result.",
            title: "Tavily key pool",
            url: "https://example.com/tavily-keypool",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);
    const firstClient = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        TAVILY_API_KEY: "first-a;first-b",
      },
    });
    const secondClient = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        TAVILY_API_KEY: "second-a;second-b",
      },
    });

    await firstClient.search("first tavily", 1);
    await firstClient.search("first tavily again", 1);
    await secondClient.search("second tavily", 1);

    const apiKeys = mockFetch.mock.calls.map(([, init]) =>
      readRequestHeader(init, "Authorization")
    );

    expect(apiKeys).toEqual([
      "Bearer first-a",
      "Bearer first-b",
      "Bearer second-a",
    ]);
  });

  it("keeps Exa fetch API key pools isolated per explicit client", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createExaFetchResponse("https://example.com/one"))
      .mockResolvedValueOnce(createExaFetchResponse("https://example.com/two"))
      .mockResolvedValueOnce(
        createExaFetchResponse("https://example.com/three")
      );
    vi.stubGlobal("fetch", mockFetch);
    const firstClient = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        EXA_API_KEY: "first-a;first-b",
      },
    });
    const secondClient = createOpenSearch({
      env: {
        ...DISABLE_HOSTED_ENV,
        EXA_API_KEY: "second-a;second-b",
      },
    });

    await firstClient.fetch("https://example.com/one");
    await firstClient.fetch("https://example.com/two");
    await secondClient.fetch("https://example.com/three");

    const apiKeys = mockFetch.mock.calls.map(([, init]) =>
      readRequestHeader(init, "x-api-key")
    );

    expect(apiKeys).toEqual(["first-a", "first-b", "second-a"]);
  });
});

function createExaFetchResponse(url: string): Response {
  return createMockJsonResponse({
    results: [
      {
        text: `# Exa explicit client body for ${url}`,
        title: "Exa explicit client key pool",
        url,
      },
    ],
    statuses: [
      {
        id: url,
        status: "success",
      },
    ],
  });
}

function readRequestHeader(
  init: unknown,
  headerName: string
): string | undefined {
  const headers = (init as RequestInit | undefined)?.headers;

  if (headers instanceof Headers) {
    return headers.get(headerName) ?? undefined;
  }

  if (headers && typeof headers === "object" && headerName in headers) {
    return String((headers as Record<string, unknown>)[headerName]);
  }

  return;
}

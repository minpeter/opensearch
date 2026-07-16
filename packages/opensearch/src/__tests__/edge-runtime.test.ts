import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { fetch, NoFetchProviderError } from "../index.ts";
import { createDuckDuckGoProvider } from "../search/duckduckgo.ts";
import { getSearchProviders } from "../search/providers.ts";
import { resetSearchEnv } from "./search-test-helpers.ts";

describe("edge runtime entry", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("rejects fetch with NoFetchProviderError when no API provider is configured", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    delete process.env.EXA_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    vi.stubGlobal("fetch", vi.fn());

    await expect(fetch("https://example.com/edge-only")).rejects.toBeInstanceOf(
      NoFetchProviderError
    );
  });

  it.each([
    ["file:///etc/passwd", "HTTP or HTTPS"],
    ["https://user:secret@example.com/", "userinfo"],
    ["not a URL", "absolute URL"],
  ])("rejects unsafe provider URL %s before routing", async (url, message) => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetch(url)).rejects.toThrow(message);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("omits DuckDuckGo from the edge provider list but adds it through the node seam", () => {
    const env = createEnvironmentReader({
      OPENSEARCH_ENABLE_EXA_MCP: "false",
      OPENSEARCH_ENABLE_PARALLEL_MCP: "false",
    });

    const edgeProviders = getSearchProviders(env);
    const nodeProviders = getSearchProviders(env, {
      duckDuckGoFactory: createDuckDuckGoProvider,
    });

    expect(
      edgeProviders.some((provider) => provider.name === "DuckDuckGo")
    ).toBe(false);
    expect(
      nodeProviders.some((provider) => provider.name === "DuckDuckGo")
    ).toBe(true);
    expect(nodeProviders).toHaveLength(edgeProviders.length + 1);
  });
});

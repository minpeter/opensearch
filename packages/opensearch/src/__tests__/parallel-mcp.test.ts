import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createParallelMcpRequestInit,
  fetchParallelMcp,
} from "../parallel-mcp.ts";

const ORIGINAL_PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;

describe("Parallel MCP transport options", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINAL_PARALLEL_API_KEY === undefined) {
      delete process.env.PARALLEL_API_KEY;
      return;
    }

    process.env.PARALLEL_API_KEY = ORIGINAL_PARALLEL_API_KEY;
  });

  it("keeps redirects manual when attaching optional auth headers", () => {
    process.env.PARALLEL_API_KEY = "parallel-key";

    const init = createParallelMcpRequestInit();

    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({
      Authorization: "Bearer parallel-key",
    });
  });

  it("does not send a semicolon-delimited Parallel MCP API key as one bearer token", () => {
    process.env.PARALLEL_API_KEY = "parallel-a;parallel-b";

    const init = createParallelMcpRequestInit();

    expect(init.headers).toEqual({
      Authorization: "Bearer parallel-a",
    });
  });

  it("rotates Parallel MCP auth headers across repeated request init calls", () => {
    process.env.PARALLEL_API_KEY = "parallel-c;parallel-d";

    const firstInit = createParallelMcpRequestInit();
    const secondInit = createParallelMcpRequestInit();

    expect([firstInit.headers, secondInit.headers]).toEqual([
      { Authorization: "Bearer parallel-c" },
      { Authorization: "Bearer parallel-d" },
    ]);
  });

  it("keeps Parallel MCP anonymous when no API key is configured", () => {
    delete process.env.PARALLEL_API_KEY;

    const init = createParallelMcpRequestInit();

    expect(init.headers).toBeUndefined();
  });

  it("forces manual redirects for SDK fetch calls that omit requestInit", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 405 }));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchParallelMcp("https://search.parallel.ai/mcp", {
      headers: { Authorization: "Bearer parallel-key" },
      method: "GET",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://search.parallel.ai/mcp",
      expect.objectContaining({
        headers: { Authorization: "Bearer parallel-key" },
        method: "GET",
        redirect: "manual",
      })
    );
  });
});

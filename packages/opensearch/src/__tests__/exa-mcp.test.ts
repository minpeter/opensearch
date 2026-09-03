import { afterEach, describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import {
  createExaMcpRequestUrl,
  fetchExaMcpTransport,
} from "../providers/exa-mcp/client.ts";
import { ResponseSizeLimitError } from "../response-body.ts";

describe("createExaMcpRequestUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects remote HTTP endpoint overrides", () => {
    const env = createEnvironmentReader({
      OPENSEARCH_EXA_MCP_URL: "http://evil.example/mcp",
    });

    expect(() => createExaMcpRequestUrl(["web_search_exa"], env)).toThrow(
      "OPENSEARCH_EXA_MCP_URL must be an HTTPS URL or a localhost URL for local testing"
    );
  });

  it("allows localhost endpoint overrides for private test gateways", () => {
    const env = createEnvironmentReader({
      OPENSEARCH_EXA_MCP_URL: "http://127.0.0.1:4111/mcp",
    });
    const url = new URL(createExaMcpRequestUrl(["web_fetch_exa"], env));

    expect(`${url.origin}${url.pathname}`).toBe("http://127.0.0.1:4111/mcp");
    expect(url.searchParams.get("tools")).toBe("web_fetch_exa");
  });

  it("cancels the Exa MCP transport with the caller signal", async () => {
    // Given
    const controller = new AbortController();
    const reason = new Error("caller cancelled Exa MCP fetch");
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal;
        notifyStarted?.();
        if (!signal) {
          return Promise.reject(new Error("transport omitted its signal"));
        }
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    // When
    const request = fetchExaMcpTransport("https://mcp.exa.ai/mcp", {
      signal: controller.signal,
    });
    await started;
    controller.abort(reason);

    // Then
    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects Exa MCP responses with an oversized content length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("ok", {
          headers: { "Content-Length": "4" },
        })
      )
    );

    await expect(
      fetchExaMcpTransport("https://mcp.exa.ai/mcp", undefined, 3)
    ).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });

  it("rejects chunked Exa MCP responses after the byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.enqueue(new Uint8Array([3, 4]));
              controller.close();
            },
          })
        )
      )
    );

    const response = await fetchExaMcpTransport(
      "https://mcp.exa.ai/mcp",
      undefined,
      3
    );

    await expect(response.text()).rejects.toBeInstanceOf(
      ResponseSizeLimitError
    );
  });
});

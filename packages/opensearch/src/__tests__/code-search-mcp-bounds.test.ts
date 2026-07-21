import { describe, expect, it } from "vitest";
import { createBoundedFetch } from "../code-search/providers/mcp-client.ts";

describe("code-search MCP response bounds", () => {
  it("rejects a streamed response once it exceeds the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456"));
        controller.enqueue(new TextEncoder().encode("789012"));
        controller.close();
      },
    });
    const boundedFetch = createBoundedFetch(
      async () => new Response(stream),
      10
    );
    const response = await boundedFetch("https://example.com");

    await expect(response.text()).rejects.toThrow(
      "MCP response exceeded 10 bytes"
    );
  });
});

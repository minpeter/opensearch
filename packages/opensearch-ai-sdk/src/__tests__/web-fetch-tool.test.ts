import type { FetchResult } from "@minpeter/opensearch";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "../index.ts";

const toolExecutionOptions: ToolExecutionOptions<unknown> = {
  context: undefined,
  messages: [],
  toolCallId: "tool-call-test",
};

const fetchResult: FetchResult = {
  content: "# Example\nReadable content.",
  length: 27,
  title: "Example",
  url: "https://example.com/",
};

function fakeClient() {
  return {
    codeSearch: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockResolvedValue([fetchResult]),
    search: vi.fn().mockResolvedValue([]),
    searchStream: vi.fn(),
  };
}

describe("web_fetch AI SDK tool", () => {
  it("rejects empty and oversized URL batches through the returned schema", () => {
    const tool = createWebFetchTool({ client: fakeClient() });

    const emptyBatch = tool.inputSchema.safeParse({ urls: [] });
    const oversizedBatch = tool.inputSchema.safeParse({
      urls: Array.from(
        { length: 11 },
        (_value, index) => `https://example.com/${index}`
      ),
    });

    expect(emptyBatch.success).toBe(false);
    expect(oversizedBatch.success).toBe(false);
  });

  it("routes urls and maxCharacters to fetch execution", async () => {
    const client = fakeClient();
    const tool = createWebFetchTool({ client });

    const output = await tool.execute(
      {
        maxCharacters: 1200,
        urls: ["https://example.com/a", "https://example.com/b"],
      },
      toolExecutionOptions
    );

    expect(client.fetch).toHaveBeenCalledWith(
      ["https://example.com/a", "https://example.com/b"],
      { maxCharacters: 1200 }
    );
    expect(output).toStrictEqual([fetchResult]);
  });

  it("returns a structured array instead of MCP content text blocks", async () => {
    const tool = createWebFetchTool({ client: fakeClient() });

    const output = await tool.execute(
      { urls: ["https://example.com/"] },
      toolExecutionOptions
    );

    expect(Array.isArray(output)).toBe(true);
    expect(output).not.toHaveProperty("content");
    expect(output[0]?.content).toContain("Readable content.");
  });

  it("rejects runtime errors from the fetch client", async () => {
    const client = fakeClient();
    client.fetch.mockRejectedValueOnce(new Error("fetch failed"));
    const tool = createWebFetchTool({ client });

    await expect(
      tool.execute({ urls: ["https://example.com/"] }, toolExecutionOptions)
    ).rejects.toThrow("fetch failed");
  });
});

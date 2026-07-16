import type { OpenSearchEvent } from "@minpeter/opensearch/node";
import { describe, expect, it, vi } from "vitest";
import { createMcpEventSink, MCP_EVENT_LOG_ENV } from "../observability.ts";

const operationEvent: OpenSearchEvent = {
  durationMs: 12,
  inputCount: 1,
  operation: "search",
  operationId: "search-test-1",
  phase: "success",
  resultCount: 3,
  timestampMs: 1234,
  type: "operation",
};

describe("MCP observability", () => {
  it("keeps structured event logging disabled by default", () => {
    expect(createMcpEventSink({})).toBeUndefined();
  });

  it("writes core events as one JSON object per stderr line when enabled", () => {
    const write = vi.fn();
    const sink = createMcpEventSink({ [MCP_EVENT_LOG_ENV]: "true" }, write);

    sink?.(operationEvent);

    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      event: operationEvent,
      scope: "opensearch",
    });
  });
});

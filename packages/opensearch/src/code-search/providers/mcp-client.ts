import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";

const MCP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MCP_TIMEOUT_MS = 8000;

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface McpTextContent {
  readonly text?: string;
  readonly type?: string;
}

export async function callMcpTool(
  serverUrl: string,
  clientName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<readonly McpTextContent[]> {
  const client = new Client(
    { name: clientName, version: "0.1.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() }
  );
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    fetch: createBoundedFetch(fetch, MCP_MAX_RESPONSE_BYTES),
    requestInit: { signal: AbortSignal.timeout(MCP_TIMEOUT_MS) },
  });

  try {
    await client.connect(transport, {
      maxTotalTimeout: MCP_TIMEOUT_MS,
      timeout: MCP_TIMEOUT_MS,
    });
    const response = await client.callTool(
      { arguments: args, name: toolName },
      undefined,
      { maxTotalTimeout: MCP_TIMEOUT_MS, timeout: MCP_TIMEOUT_MS }
    );
    if (response.isError) {
      throw new Error(readMcpErrorText(response.content));
    }
    return (response.content ?? []) as readonly McpTextContent[];
  } finally {
    await transport.close().catch(() => {
      // Close errors must not replace the tool result.
    });
  }
}

export function createBoundedFetch(
  baseFetch: FetchFunction,
  maxBytes: number
): FetchFunction {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel();
      throw new Error(`MCP response exceeded ${maxBytes} bytes`);
    }
    if (!response.body) {
      return response;
    }
    return new Response(createBoundedStream(response.body, maxBytes), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

function createBoundedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let totalBytes = 0;
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          controller.error(
            new Error(`MCP response exceeded ${maxBytes} bytes`)
          );
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function readMcpErrorText(content: unknown): string {
  const text = Array.isArray(content)
    ? content
        .filter(
          (item): item is { text?: string; type?: string } =>
            typeof item === "object" && item !== null
        )
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n")
        .trim()
    : "";
  return text || "MCP tool call failed";
}

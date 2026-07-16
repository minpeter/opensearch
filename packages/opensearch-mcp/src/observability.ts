import type { OpenSearchEventSink } from "@minpeter/opensearch/node";

export const MCP_EVENT_LOG_ENV = "OPENSEARCH_MCP_LOG_EVENTS";

export function createMcpEventSink(
  env: Readonly<Record<string, string | undefined>> = process.env,
  write: (line: string) => void = (line) => {
    console.error(line);
  }
): OpenSearchEventSink | undefined {
  if (env[MCP_EVENT_LOG_ENV] !== "true") {
    return;
  }

  return (event) => {
    write(JSON.stringify({ event, scope: "opensearch" }));
  };
}

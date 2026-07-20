import { createOpenSearch } from "@minpeter/opensearch/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../package.json" with { type: "json" };
import { createMcpEventSink } from "./observability.ts";
import {
  webFetchDescription,
  webSearchDescription,
} from "./tool-descriptions.ts";
import {
  createFetchToolResult,
  createSearchToolResult,
  createToolErrorResponse,
  getFetchMaxCharacters,
  getSearchResultCount,
  webFetchInputSchema,
  webSearchInputSchema,
} from "./tool-io.ts";

const server = new McpServer({
  name: "opensearch",
  version: pkg.version,
});
const eventSink = createMcpEventSink();
const client = createOpenSearch(
  eventSink ? { observability: { onEvent: eventSink } } : {}
);

server.registerTool(
  "web_search",
  {
    description: webSearchDescription,
    inputSchema: webSearchInputSchema,
  },
  async (input) => {
    try {
      return createSearchToolResult(
        input.query,
        await client.search(input.query, getSearchResultCount(input))
      );
    } catch (error) {
      return createToolErrorResponse("web_search", "Search", error);
    }
  }
);

server.registerTool(
  "web_fetch",
  {
    description: webFetchDescription,
    inputSchema: webFetchInputSchema,
  },
  async (input) => {
    try {
      const results = await client.fetch(input.urls, {
        maxCharacters: getFetchMaxCharacters(input),
      });
      return createFetchToolResult(results);
    } catch (error) {
      return createToolErrorResponse("web_fetch", "Fetch", error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "./environment.ts";
import {
  createExaMcpServerUrl,
  DEFAULT_EXA_MCP_FETCH_TOOL,
  DEFAULT_EXA_MCP_SEARCH_TOOL,
  DEFAULT_EXA_MCP_SERVER_URL,
  type ExaMcpContentItem,
  parseExaMcpContentItems,
  parseExaMcpFetchContentItems,
} from "./exa-mcp-provider.ts";
import { getBaseUrl } from "./search/api-provider-utils.ts";

const EXA_MCP_TIMEOUT_MS = 8000;
const EXA_MCP_FETCH_MAX_CHARACTERS = 12_000;
const EXA_MCP_URL_ENV = "OPENSEARCH_EXA_MCP_URL";

export interface ExaMcpSearchResult {
  snippet: string;
  title: string;
  url: string;
}

export interface ExaMcpFetchResult {
  content: string;
  title: string;
  url: string;
}

export function searchExaMcp(
  query: string,
  numResults: number,
  env: EnvironmentReader = processEnvironmentReader
): Promise<ExaMcpSearchResult[]> {
  return withExaMcpClient(
    [DEFAULT_EXA_MCP_SEARCH_TOOL],
    env,
    async ({ client }) => {
      const response = await client.callTool({
        arguments: {
          numResults,
          query,
        },
        name: DEFAULT_EXA_MCP_SEARCH_TOOL,
      });

      if (response.isError) {
        throw new Error(getExaMcpErrorText(response.content));
      }

      return parseExaMcpContentItems(
        response.content as ExaMcpContentItem[]
      ).map(({ engine: _engine, ...result }) => result);
    }
  );
}

export function fetchExaMcp(
  url: string,
  env: EnvironmentReader = processEnvironmentReader
): Promise<ExaMcpFetchResult> {
  return fetchExaMcpBatch([url], undefined, env).then((results) => {
    const [result] = results;

    if (!result) {
      throw new Error("Exa MCP fetch returned an unexpected response shape");
    }

    return result;
  });
}

export function fetchExaMcpBatch(
  urls: string[],
  maxCharacters = EXA_MCP_FETCH_MAX_CHARACTERS,
  env: EnvironmentReader = processEnvironmentReader
): Promise<ExaMcpFetchResult[]> {
  return withExaMcpClient(
    [DEFAULT_EXA_MCP_FETCH_TOOL],
    env,
    async ({ client }) => {
      const response = await client.callTool({
        arguments: {
          maxCharacters,
          urls,
        },
        name: DEFAULT_EXA_MCP_FETCH_TOOL,
      });

      if (response.isError) {
        throw new Error(getExaMcpErrorText(response.content));
      }

      const results = parseExaMcpFetchContentItems(
        response.content as ExaMcpContentItem[]
      );

      if (results.length === 0) {
        throw new Error("Exa MCP fetch returned an unexpected response shape");
      }

      return results;
    }
  );
}

async function withExaMcpClient<T>(
  enabledTools: string[],
  env: EnvironmentReader,
  run: (context: { client: Client }) => Promise<T>
): Promise<T> {
  const client = new Client({
    name: "opensearch-exa-mcp-client",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(createExaMcpRequestUrl(enabledTools, env)),
    {
      requestInit: {
        signal: AbortSignal.timeout(EXA_MCP_TIMEOUT_MS),
      },
    }
  );

  try {
    await client.connect(transport);
    return await run({ client });
  } finally {
    await transport.close().catch(() => {
      // Ignore close errors; the search result/error is more important.
    });
  }
}

function getExaMcpErrorText(content: unknown): string {
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

  return text || "Exa MCP search failed";
}

export function createExaMcpRequestUrl(
  enabledTools: string[],
  env: EnvironmentReader = processEnvironmentReader
): string {
  return createExaMcpServerUrl(
    getBaseUrl(EXA_MCP_URL_ENV, DEFAULT_EXA_MCP_SERVER_URL, env),
    enabledTools
  );
}

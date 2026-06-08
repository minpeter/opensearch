import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type ApiKeyPool,
  getApiKeyPool,
} from "../../credentials/api-key-pool.ts";
import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";
import { getErrorMessage } from "../shared/error.ts";
import {
  DEFAULT_PARALLEL_MCP_SEARCH_TOOL,
  DEFAULT_PARALLEL_MCP_SERVER_URL,
  parseParallelMcpContentItems,
  parseParallelMcpPayload,
} from "./content.ts";

const PARALLEL_MCP_TIMEOUT_MS = 8000;
const PARALLEL_MCP_SESSION_ID = `opensearch_${randomUUID().replaceAll("-", "")}`;
const parallelMcpApiKeyPools = new WeakMap<EnvironmentReader, ApiKeyPool>();

export interface ParallelMcpSearchResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export function searchParallelMcp(
  query: string,
  env: EnvironmentReader = processEnvironmentReader
): Promise<ParallelMcpSearchResult[]> {
  return withParallelMcpClient(env, async ({ client }) => {
    const response = await client.callTool({
      arguments: {
        objective: query,
        search_queries: [query],
        session_id: PARALLEL_MCP_SESSION_ID,
      },
      name: DEFAULT_PARALLEL_MCP_SEARCH_TOOL,
    });

    if (response.isError) {
      throw new Error(getMcpErrorText(response.content));
    }

    const structuredResults = parseParallelMcpPayload(
      response.structuredContent
    );
    const results =
      structuredResults.length > 0
        ? structuredResults
        : parseParallelMcpContentItems(response.content);

    if (results.length === 0) {
      throw new Error("Parallel MCP search returned an unexpected shape");
    }

    return results.map(({ engine: _engine, ...result }) => result);
  });
}

async function withParallelMcpClient<T>(
  env: EnvironmentReader,
  run: (context: { readonly client: Client }) => Promise<T>
): Promise<T> {
  const client = new Client({
    name: "opensearch-parallel-mcp-client",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(DEFAULT_PARALLEL_MCP_SERVER_URL),
    {
      fetch: fetchParallelMcp,
      requestInit: createParallelMcpRequestInit(env),
    }
  );

  try {
    await client.connect(transport);
    return await run({ client });
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export function createParallelMcpRequestInit(
  env: EnvironmentReader = processEnvironmentReader
): RequestInit {
  return {
    headers: createAuthHeaders(env),
    redirect: "manual",
    signal: AbortSignal.timeout(PARALLEL_MCP_TIMEOUT_MS),
  };
}

export function fetchParallelMcp(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, {
    ...init,
    redirect: init?.redirect ?? "manual",
  });
}

function createAuthHeaders(
  env: EnvironmentReader
): Record<string, string> | undefined {
  const [apiKey] = getParallelMcpApiKeyPool(env).getAttemptOrder();
  if (!apiKey) {
    return;
  }

  return { Authorization: `Bearer ${apiKey}` };
}

function getParallelMcpApiKeyPool(env: EnvironmentReader): ApiKeyPool {
  const existingPool = parallelMcpApiKeyPools.get(env);
  if (existingPool) {
    return existingPool;
  }

  const apiKeyPool = getApiKeyPool("PARALLEL_API_KEY", env);
  parallelMcpApiKeyPools.set(env, apiKeyPool);
  return apiKeyPool;
}

function getMcpErrorText(content: unknown): string {
  const parsedContent = Array.isArray(content) ? content : [];
  const text = parsedContent
    .filter(
      (item): item is { readonly text?: string; readonly type?: string } =>
        typeof item === "object" && item !== null
    )
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();

  return text || `Parallel MCP search failed: ${getErrorMessage(content)}`;
}

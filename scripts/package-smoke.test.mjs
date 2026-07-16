import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyMcpServer } from "./mcp-protocol-smoke.mjs";
import { retryOperation } from "./package-smoke.mjs";

const MCP_PACKAGE_MANIFEST_PATH = fileURLToPath(
  new URL("../packages/opensearch-mcp/package.json", import.meta.url)
);
const STALE_VERSION_ERROR =
  /MCP server version must match the installed package version/u;
const TOOL_SURFACE_ERROR = /MCP tool surface must match the package contract/u;

const createFakeMcpServer = async ({
  serverVersion = "0.2.7",
  tools = ["web_fetch", "web_search"],
}) => {
  const directory = await mkdtemp(join(tmpdir(), "opensearch-mcp-smoke-"));
  const binaryPath = join(directory, "server.mjs");
  const source = `
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      jsonrpc: "2.0",
      result: {
        capabilities: { tools: {} },
        protocolVersion: message.params.protocolVersion,
        serverInfo: { name: "opensearch", version: ${JSON.stringify(serverVersion)} },
      },
    }) + "\\n");
  }
  if (message.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      jsonrpc: "2.0",
      result: {
        tools: ${JSON.stringify(tools)}.map((name) => ({
          inputSchema: { type: "object" },
          name,
        })),
      },
    }) + "\\n");
  }
}
`;
  await writeFile(binaryPath, source);
  return { binaryPath, directory };
};

test("registry smoke retries transient install failures", async () => {
  const operationAttempts = [];
  const retriedAttempts = [];

  const result = await retryOperation({
    attempts: 3,
    delayMs: 0,
    operation: (attempt) => {
      operationAttempts.push(attempt);
      if (attempt < 3) {
        throw new Error(`registry lag ${attempt}`);
      }
      return "installed";
    },
    onRetry: ({ attempt }) => {
      retriedAttempts.push(attempt);
    },
  });

  assert.equal(result, "installed");
  assert.deepEqual(operationAttempts, [1, 2, 3]);
  assert.deepEqual(retriedAttempts, [1, 2]);
});

test("registry smoke preserves the final install failure", async () => {
  const finalFailure = new Error("package is invalid");
  let operationAttempts = 0;

  await assert.rejects(
    retryOperation({
      attempts: 2,
      delayMs: 0,
      operation: () => {
        operationAttempts += 1;
        throw operationAttempts === 2
          ? finalFailure
          : new Error("registry lag");
      },
    }),
    (error) => error === finalFailure
  );
  assert.equal(operationAttempts, 2);
});

test("MCP package smoke completes initialize and tools/list", async () => {
  const { binaryPath, directory } = await createFakeMcpServer({});
  try {
    const result = await verifyMcpServer({
      binaryPath,
      expectedServerName: "opensearch",
      expectedTools: ["web_fetch", "web_search"],
      expectedVersion: "0.2.7",
      packageManifestPath: MCP_PACKAGE_MANIFEST_PATH,
    });

    assert.deepEqual(result.serverInfo, {
      name: "opensearch",
      version: "0.2.7",
    });
    assert.deepEqual(result.tools, ["web_fetch", "web_search"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("MCP package smoke rejects a stale bundled version", async () => {
  const { binaryPath, directory } = await createFakeMcpServer({
    serverVersion: "0.2.6",
  });
  try {
    await assert.rejects(
      verifyMcpServer({
        binaryPath,
        expectedServerName: "opensearch",
        expectedTools: ["web_fetch", "web_search"],
        expectedVersion: "0.2.7",
        packageManifestPath: MCP_PACKAGE_MANIFEST_PATH,
      }),
      STALE_VERSION_ERROR
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("MCP package smoke rejects an incomplete tool surface", async () => {
  const { binaryPath, directory } = await createFakeMcpServer({
    tools: ["web_search"],
  });
  try {
    await assert.rejects(
      verifyMcpServer({
        binaryPath,
        expectedServerName: "opensearch",
        expectedTools: ["web_fetch", "web_search"],
        expectedVersion: "0.2.7",
        packageManifestPath: MCP_PACKAGE_MANIFEST_PATH,
      }),
      TOOL_SURFACE_ERROR
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

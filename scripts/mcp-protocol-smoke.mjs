import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_STDERR_CHARACTERS = 8192;

const contractMismatch = (message, expected, actual) =>
  new Error(
    `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`
  );

const requireEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw contractMismatch(message, expected, actual);
  }
};

const resolveSdkModules = async (packageManifestPath) => {
  const packageRequire = createRequire(packageManifestPath);
  const clientPath = packageRequire.resolve(
    "@modelcontextprotocol/sdk/client/index.js"
  );
  const transportPath = packageRequire.resolve(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );

  return await Promise.all([
    import(pathToFileURL(clientPath).href),
    import(pathToFileURL(transportPath).href),
  ]);
};

export const verifyMcpServer = async ({
  binaryPath,
  expectedServerName,
  expectedTools,
  expectedVersion,
  packageManifestPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  const [{ Client }, { StdioClientTransport }] =
    await resolveSdkModules(packageManifestPath);
  const transport = new StdioClientTransport({
    args: [binaryPath],
    command: process.execPath,
    cwd: dirname(binaryPath),
    stderr: "pipe",
  });
  let stderrOutput = "";
  const stderr = transport.stderr;
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
    stderrOutput = `${stderrOutput}${chunk}`.slice(-MAX_STDERR_CHARACTERS);
  });

  const client = new Client({
    name: "opensearch-package-smoke",
    version: "1.0.0",
  });
  const requestOptions = {
    maxTotalTimeout: timeoutMs,
    timeout: timeoutMs,
  };
  let verificationResult;

  try {
    await client.connect(transport, requestOptions);
    const serverInfo = client.getServerVersion();
    requireEqual(
      serverInfo?.name,
      expectedServerName,
      "MCP server name must match the package contract"
    );
    requireEqual(
      serverInfo?.version,
      expectedVersion,
      "MCP server version must match the installed package version"
    );

    const { tools = [] } = await client.listTools(undefined, requestOptions);
    const actualTools = tools.map(({ name }) => name).sort();
    const sortedExpectedTools = [...expectedTools].sort();
    const toolSurfaceMatches =
      actualTools.length === sortedExpectedTools.length &&
      actualTools.every((tool, index) => tool === sortedExpectedTools[index]);
    if (!toolSurfaceMatches) {
      throw contractMismatch(
        "MCP tool surface must match the package contract",
        sortedExpectedTools,
        actualTools
      );
    }

    verificationResult = { serverInfo, tools: actualTools };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    const diagnostic = stderrOutput.trim();
    const verificationError =
      diagnostic.length === 0
        ? normalizedError
        : new Error(`${normalizedError.message} Stderr: ${diagnostic}`, {
            cause: normalizedError,
          });
    try {
      await client.close();
    } catch {
      // Preserve the protocol failure instead of replacing it with cleanup noise.
    }
    throw verificationError;
  }

  await client.close();
  return verificationResult;
};

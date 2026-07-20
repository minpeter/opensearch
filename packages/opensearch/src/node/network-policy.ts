import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, type Dispatcher } from "undici";
import type { LocalFetchOptions } from "../fetch/local-options.ts";
import type { FetchUrlValidator } from "../fetch/orchestration.ts";

const BLOCKED_HOST_SUFFIXES = [
  ".example",
  ".home.arpa",
  ".internal",
  ".invalid",
  ".local",
  ".localhost",
  ".test",
] as const;
const TRAILING_DOT_REGEX = /\.$/u;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export class NetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkPolicyError";
  }
}

export function assertSafeHttpUrl(
  rawUrl: string | URL,
  allowPrivateNetwork = false
): URL {
  const url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new NetworkPolicyError("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new NetworkPolicyError("URL userinfo is not allowed");
  }
  if (allowPrivateNetwork) {
    return url;
  }

  const hostname = normalizeHostname(url.hostname);
  const family = isIP(hostname);
  if (family > 0) {
    assertPublicIpAddress(hostname);
    return url;
  }
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new NetworkPolicyError(
      `Private network hostname is not allowed: ${hostname}`
    );
  }
  return url;
}

export function createFetchUrlValidator(
  options: Pick<LocalFetchOptions, "allowPrivateNetwork"> = {}
): FetchUrlValidator {
  return (url) => {
    assertSafeHttpUrl(url, options.allowPrivateNetwork ?? false);
  };
}

export function assertPublicIpAddress(address: string): void {
  const family = isIP(address);
  if (family === 0) {
    throw new NetworkPolicyError(`Invalid IP address: ${address}`);
  }
  if (blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4")) {
    throw new NetworkPolicyError(
      `Private network address is not allowed: ${address}`
    );
  }
}

export function createNetworkDispatcher(options: {
  readonly allowPrivateNetwork: boolean;
  readonly maxResponseBytes: number;
}): Dispatcher {
  return new Agent({
    connect: options.allowPrivateNetwork
      ? undefined
      : { lookup: createPublicLookup() },
    maxOrigins: 64,
    maxResponseSize: options.maxResponseBytes,
    pipelining: 0,
  });
}

function createPublicLookup(): LookupFunction {
  return (hostname, options, callback) => {
    lookup(
      hostname,
      { ...options, all: true, order: "verbatim" },
      (error, addresses) => {
        if (error) {
          callback(error, "", 0);
          return;
        }
        try {
          for (const { address } of addresses) {
            assertPublicIpAddress(address);
          }
        } catch (lookupError) {
          callback(asLookupError(lookupError), "", 0);
          return;
        }

        if (options.all) {
          callback(null, addresses);
          return;
        }
        const [first] = addresses;
        if (!first) {
          callback(
            asLookupError(new Error("Hostname resolved to no addresses")),
            "",
            0
          );
          return;
        }
        callback(null, first.address, first.family);
      }
    );
  };
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(TRAILING_DOT_REGEX, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function asLookupError(error: unknown): NodeJS.ErrnoException {
  const normalized =
    error instanceof Error ? error : new Error("Network policy lookup failed");
  return Object.assign(normalized, { code: "ERR_OPENSEARCH_PRIVATE_NETWORK" });
}

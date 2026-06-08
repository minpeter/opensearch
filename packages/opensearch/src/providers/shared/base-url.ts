import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../../environment.ts";

export function getBaseUrl(
  envName: string,
  defaultBaseUrl: string,
  env: EnvironmentReader = processEnvironmentReader
): string {
  const configuredUrl = env.read(envName)?.trim();
  if (!configuredUrl) {
    return defaultBaseUrl;
  }

  return requireTrustedProviderBaseUrl(envName, configuredUrl);
}

export function requireTrustedProviderBaseUrl(
  envName: string,
  baseUrl: string
): string {
  if (isTrustedProviderBaseUrl(baseUrl)) {
    return baseUrl;
  }

  throw new Error(
    `${envName} must be an HTTPS URL or a localhost URL for local testing`
  );
}

export function createBasicAuthHeader(
  username: string,
  password: string
): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function isTrustedProviderBaseUrl(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol === "https:") {
    return true;
  }

  if (url.protocol !== "http:") {
    return false;
  }

  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
}

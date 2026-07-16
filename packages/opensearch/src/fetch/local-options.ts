import { DEFAULT_MAX_RESPONSE_BYTES } from "../response-body.ts";

export const DEFAULT_MAX_DOWNLOAD_BYTES = DEFAULT_MAX_RESPONSE_BYTES;
export const DEFAULT_MAX_REDIRECTS = 5;

export interface LocalFetchOptions {
  /** Allow loopback, link-local, private, and internal-network destinations. */
  readonly allowPrivateNetwork?: boolean;
  /** Maximum decoded response body retained for one local download. */
  readonly maxDownloadBytes?: number;
  /** Maximum HTTP redirects followed by the local Node fetcher. */
  readonly maxRedirects?: number;
}

export interface ResolvedLocalFetchOptions {
  readonly allowPrivateNetwork: boolean;
  readonly maxDownloadBytes: number;
  readonly maxRedirects: number;
}

export function resolveLocalFetchOptions(
  options: LocalFetchOptions = {}
): ResolvedLocalFetchOptions {
  return {
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
    maxDownloadBytes: requirePositiveSafeInteger(
      options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES,
      "fetch.maxDownloadBytes"
    ),
    maxRedirects: requireNonNegativeSafeInteger(
      options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      "fetch.maxRedirects"
    ),
  };
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

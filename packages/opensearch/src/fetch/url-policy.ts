export function assertProviderSafeUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypeError("Fetch URL must be an absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Fetch URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("Fetch URL userinfo is not allowed");
  }
}

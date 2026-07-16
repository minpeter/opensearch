import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalFetch } from "../fetch/local.ts";
import {
  assertPublicIpAddress,
  assertSafeHttpUrl,
  NetworkPolicyError,
} from "../node/network-policy.ts";
import { createOpenSearch } from "../node.ts";

const ARTICLE_HTML = `<!doctype html><html><head><title>Safe page</title></head>
<body><article><h1>Safe page</h1><p>This public response contains enough
content for Readability to return it without invoking a remote fallback.</p>
<p>Another paragraph keeps the extraction deterministic.</p></article></body></html>`;

describe("Node local-fetch network policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "http://localhost/admin",
    "http://service/internal",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://metadata.google.internal/",
  ])("rejects private destination %s before issuing a request", async (url) => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(createLocalFetch()(url)).rejects.toBeInstanceOf(
      NetworkPolicyError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes and URL userinfo", () => {
    expect(() => assertSafeHttpUrl("file:///etc/passwd")).toThrow(
      "Only HTTP and HTTPS"
    );
    expect(() => assertSafeHttpUrl("https://user:secret@example.com/")).toThrow(
      "userinfo"
    );
  });

  it("classifies resolved public and private addresses", () => {
    expect(() => assertPublicIpAddress("8.8.8.8")).not.toThrow();
    expect(() => assertPublicIpAddress("2606:4700:4700::1111")).not.toThrow();
    expect(() => assertPublicIpAddress("127.0.0.1")).toThrow("Private network");
    expect(() => assertPublicIpAddress("::ffff:127.0.0.1")).toThrow(
      "Private network"
    );
  });

  it("blocks a redirect to cloud metadata before following it", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        Response.redirect("http://169.254.169.254/latest/meta-data/", 302)
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      createLocalFetch()("https://example.com/start")
    ).rejects.toThrow("Private network");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("validates before a generic public-API route can issue a request", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      createOpenSearch().fetch("http://127.0.0.1/@admin")
    ).rejects.toBeInstanceOf(NetworkPolicyError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("validates every batch URL before issuing public-API requests", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      createOpenSearch().fetch([
        "https://mastodon.social/@alice",
        "http://169.254.169.254/@metadata",
      ])
    ).rejects.toBeInstanceOf(NetworkPolicyError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enforces a redirect-count limit", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(Response.redirect("https://example.org/next", 302));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      createLocalFetch({ maxRedirects: 0 })("https://example.com/start")
    ).rejects.toThrow("0-redirect limit");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects declared and streamed bodies over the byte limit", async () => {
    const fetchWithDeclaredLength = vi.fn().mockResolvedValue(
      new Response("small", {
        headers: { "Content-Length": "1000" },
      })
    );
    vi.stubGlobal("fetch", fetchWithDeclaredLength);
    await expect(
      createLocalFetch({ maxDownloadBytes: 64 })("https://example.com/large")
    ).rejects.toThrow("64-byte download limit");

    const fetchWithChunkedBody = vi
      .fn()
      .mockResolvedValue(new Response("x".repeat(65)));
    vi.stubGlobal("fetch", fetchWithChunkedBody);
    await expect(
      createLocalFetch({ maxDownloadBytes: 64 })("https://example.com/chunked")
    ).rejects.toThrow("64-byte download limit");
  });

  it("allows an explicit private-network opt-in", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(ARTICLE_HTML, {
        headers: { "Content-Type": "text/html" },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await createLocalFetch({ allowPrivateNetwork: true })(
      "http://127.0.0.1/docs"
    );

    expect(result.title).toBe("Safe page");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

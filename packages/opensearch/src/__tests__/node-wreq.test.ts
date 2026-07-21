import { describe, expect, it, vi } from "vitest";
import { fetchWreqWithRedirectPolicy, readWreqText } from "../node/wreq.ts";
import { ResponseSizeLimitError } from "../response-body.ts";

function redirectResponse(location: string) {
  return {
    body: null,
    headers: new Headers({ Location: location }),
    status: 302,
    text: () => Promise.resolve(""),
    url: "https://example.com/start",
  };
}

function okResponse() {
  return {
    body: null,
    headers: new Headers(),
    status: 200,
    text: () => Promise.resolve("<html>ok</html>"),
    url: "https://example.com/final",
  };
}

describe("fetchWreqWithRedirectPolicy", () => {
  it("enforces the redirect limit even without a URL validator", async () => {
    const wreq = {
      fetch: vi
        .fn()
        .mockResolvedValue(redirectResponse("https://example.com/next")),
    };

    await expect(
      fetchWreqWithRedirectPolicy(wreq, "https://example.com/start", {}, {})
    ).rejects.toThrow("exceeded the 5-redirect limit");
  });

  it("follows redirects manually with redirect: manual even without a validator", async () => {
    const wreq = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(redirectResponse("https://example.com/final"))
        .mockResolvedValueOnce(okResponse()),
    };

    const response = await fetchWreqWithRedirectPolicy(
      wreq,
      "https://example.com/start",
      {},
      {}
    );

    expect(response.status).toBe(200);
    expect(wreq.fetch).toHaveBeenCalledTimes(2);
    expect(wreq.fetch).toHaveBeenLastCalledWith(
      "https://example.com/final",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("validates every redirect hop when a validator is present", async () => {
    const wreq = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(redirectResponse("https://evil.example/"))
        .mockResolvedValueOnce(okResponse()),
    };
    const validateUrl = vi.fn();

    await fetchWreqWithRedirectPolicy(
      wreq,
      "https://example.com/start",
      {},
      { validateUrl }
    );

    expect(validateUrl).toHaveBeenCalledWith("https://example.com/start");
    expect(validateUrl).toHaveBeenCalledWith("https://evil.example/");
  });
});

describe("readWreqText", () => {
  it("does not call response.text when wreq exposes no body", async () => {
    const text = vi.fn().mockResolvedValue("unexpected");

    await expect(
      readWreqText({ body: null, headers: new Headers(), status: 204, text })
    ).resolves.toBe("");

    expect(text).not.toHaveBeenCalled();
  });

  it("rejects oversized declared null-body responses before text fallback", async () => {
    const text = vi.fn().mockResolvedValue("small");

    await expect(
      readWreqText(
        {
          body: null,
          headers: new Headers({ "Content-Length": "101" }),
          status: 200,
          text,
        },
        100
      )
    ).rejects.toBeInstanceOf(ResponseSizeLimitError);

    expect(text).not.toHaveBeenCalled();
  });
});

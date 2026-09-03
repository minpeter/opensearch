import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUrl, fetchUrls } from "../fetch.ts";

const apiResponse = (title: string): Response =>
  Response.json({ by: "tester", text: "body", title });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("legacy top-level fetch entrypoints", () => {
  it("makes two transports for two identical fetchUrl calls", async () => {
    // Given
    const transport = vi
      .fn()
      .mockImplementation(() => Promise.resolve(apiResponse("single")));
    vi.stubGlobal("fetch", transport);
    const url = "https://news.ycombinator.com/item?id=9001";

    // When
    await fetchUrl(url);
    await fetchUrl(url);

    // Then
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("passes caller abort through fetchUrl without starting transport", async () => {
    // Given
    const controller = new AbortController();
    const callerAbort = new Error("caller stopped single fetch");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    controller.abort(callerAbort);

    // When
    const operation = Promise.resolve().then(() =>
      fetchUrl("https://news.ycombinator.com/item?id=9003", {
        signal: controller.signal,
      })
    );

    // Then
    await expect(operation).rejects.toBe(callerAbort);
    expect(transport).not.toHaveBeenCalled();
  });

  it("makes two transports for two identical fetchUrls calls", async () => {
    // Given
    const transport = vi
      .fn()
      .mockImplementation(() => Promise.resolve(apiResponse("batch")));
    vi.stubGlobal("fetch", transport);
    const urls = ["https://news.ycombinator.com/item?id=9002"];

    // When
    await fetchUrls(urls);
    await fetchUrls(urls);

    // Then
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("passes caller abort through fetchUrls without starting transport", async () => {
    // Given
    const controller = new AbortController();
    const callerAbort = new Error("caller stopped batch fetch");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    controller.abort(callerAbort);

    // When
    const operation = Promise.resolve().then(() =>
      fetchUrls(
        ["https://news.ycombinator.com/item?id=9004"],
        undefined,
        undefined,
        controller.signal
      )
    );

    // Then
    await expect(operation).rejects.toBe(callerAbort);
    expect(transport).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";

import { getRandomUserAgent, userAgents } from "../user-agents.ts";

describe("userAgents", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(userAgents)).toBe(true);
    expect(userAgents.length).toBeGreaterThan(0);
  });

  it("has at least 10 entries", () => {
    expect(userAgents.length).toBeGreaterThanOrEqual(10);
  });

  it("every entry is a non-empty string", () => {
    expect(
      userAgents.every((ua) => typeof ua === "string" && ua.length > 0)
    ).toBe(true);
  });

  it('every entry contains "Mozilla"', () => {
    expect(userAgents.every((ua) => ua.includes("Mozilla"))).toBe(true);
  });
});

describe("getRandomUserAgent", () => {
  it("returns a string from the userAgents array", () => {
    const ua = getRandomUserAgent();
    expect(typeof ua).toBe("string");
    expect(userAgents).toContain(ua);
  });
});

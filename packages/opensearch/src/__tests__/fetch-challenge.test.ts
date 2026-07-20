import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isChallengePage, validateChallenge } from "../fetch/challenge.ts";

describe("isChallengePage", () => {
  it("flags strong vendor tokens unconditionally", () => {
    expect(
      isChallengePage(
        `<html><head><script src="/cdn-cgi/challenge-platform/x.js"></script></head><body>${"x".repeat(5000)}</body></html>`
      )
    ).toBe(true);
    expect(isChallengePage("<html>cf-chl-bypass</html>")).toBe(true);
  });

  it("flags a Cloudflare interstitial via the title", () => {
    expect(
      isChallengePage(
        "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>"
      )
    ).toBe(true);
  });

  it("flags a tiny body carrying a weak marker", () => {
    expect(
      isChallengePage("<html><body>Verify you are human</body></html>")
    ).toBe(true);
  });

  it("does NOT flag a long legit article that merely mentions a marker word", () => {
    const article = `<html><head><title>How CAPTCHA and DataDome work</title></head><body>${"<p>A long, real article about anti-bot systems and access denied pages. </p>".repeat(120)}</body></html>`;
    expect(isChallengePage(article)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isChallengePage("")).toBe(false);
  });
});

describe("validateChallenge", () => {
  it("returns challenge verdicts for generic markers", () => {
    const result = validateChallenge({
      body: '<html><form id="sec-if-cpt-container"></form></html>',
    });
    expect(result.verdict).toBe("challenge");
    expect(result.reasons).toContain("marker:sec-if-cpt-container");
  });

  it("flags tiny bodies without positive proof", () => {
    const result = validateChallenge({ body: "<html>ok</html>" });
    expect(result.verdict).toBe("challenge");
    expect(result.reasons).toEqual(["tiny_body:15"]);
  });

  it("promotes matching success selectors to strong_ok", () => {
    const result = validateChallenge({
      body: '<main id="content"><h1>Loaded</h1></main>',
      successSelectors: ["#content"],
    });
    expect(result.verdict).toBe("strong_ok");
    expect(result.matchedSelectors).toEqual(["#content"]);
  });

  it("uses weak_ok when no selector proof is available", () => {
    const result = validateChallenge({
      body: `<article>${"content ".repeat(500)}</article>`,
    });
    expect(result.verdict).toBe("weak_ok");
    expect(result.reasons).toEqual([]);
  });

  it("demotes selector proof when cookie sensors are unresolved", () => {
    const result = validateChallenge({
      body: '<main id="content">Loaded</main>',
      cookies: { _abck: "abc~-1~def" },
      successSelectors: ["#content"],
    });
    expect(result.verdict).toBe("weak_ok");
    expect(result.reasons).toEqual(["abck_unresolved"]);
  });

  it("treats blocked statuses as blocked", () => {
    const result = validateChallenge({ body: "", status: 430 });
    expect(result.verdict).toBe("blocked");
    expect(result.reasons).toEqual(["status:430"]);
  });

  it("ranks WAF profiles by detector confidence", () => {
    const result = validateChallenge({
      body: "Just a moment...",
      cookies: { __cf_bm: "token" },
      headers: { "cf-ray": "abc", server: "cloudflare" },
    });
    expect(result.profiles[0]).toMatchObject({
      confidence: 0.9,
      profileId: "cloudflare_turnstile",
    });
  });

  it("falls back to default profiles when provided profiles are invalid", () => {
    const result = validateChallenge({
      body: "Loaded",
      profileSource: [],
    });
    expect(result.profileLoadError).toBe("profile_loader:invalid_shape");
    expect(result.profiles.at(-1)?.profileId).toBe("unknown_challenge");
  });

  it("honors known bad response sizes before selector proof", () => {
    const result = validateChallenge({
      body: '<main id="content">Loaded</main>',
      knownBadSizes: [30],
      successSelectors: ["#content"],
    });
    expect(result.verdict).toBe("challenge");
    expect(result.reasons).toEqual(["size_fp:32~30"]);
  });
});

describe("no-site-name guard", () => {
  it("keeps generic WAF modules free of site-specific names", () => {
    const genericFiles = [
      "src/fetch/challenge-selectors.ts",
      "src/fetch/challenge.ts",
      "src/fetch/waf-profile-defaults.ts",
      "src/fetch/waf-profiles.ts",
    ];
    const banned = [
      "coupang",
      "fmkorea",
      "linkedin",
      "naver.com",
      "blog.naver",
      "shopping.naver",
    ];

    for (const file of genericFiles) {
      const source = readFileSync(
        join(process.cwd(), file),
        "utf8"
      ).toLowerCase();
      for (const token of banned) {
        expect(source).not.toContain(token);
      }
    }
  });
});

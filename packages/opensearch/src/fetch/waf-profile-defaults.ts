import type { WafProfile } from "./waf-profiles.ts";

export const DEFAULT_WAF_PROFILES = [
  {
    id: "akamai_bot_manager",
    detectors: {
      body: ["sec-if-cpt-container", "Powered and protected by Akamai"],
      cookie: ["_abck", "bm_sz", "ak_bmsc", "bm_sv", "bm_so"],
      header: ["X-Akamai-*"],
      server_contains: ["AkamaiGHost"],
    },
    confidenceRules: { strong: 2, weak: 1 },
    fallbackWhenChallenge: ["curl_grid_exhaust", "playwright_real_chrome"],
  },
  {
    id: "cloudflare_turnstile",
    detectors: {
      body: [
        "Just a moment...",
        "Checking your browser",
        "cf-chl-bypass",
        "Attention Required! | Cloudflare",
      ],
      cookie: ["cf_clearance", "__cf_bm", "__cfduid"],
      header: ["cf-ray", "cf-cache-status"],
      server_contains: ["cloudflare"],
    },
    confidenceRules: { strong: 2, weak: 1 },
    fallbackWhenChallenge: ["playwright_mcp", "playwright_real_chrome"],
  },
  {
    id: "f5_big_ip",
    detectors: {
      body: ["The requested URL was rejected", "support ID is:"],
      cookie: ["BigIPServer", "TS01*", "F5_*"],
    },
    confidenceRules: { strong: 2, weak: 1 },
  },
  {
    id: "aws_waf",
    detectors: {
      cookie: ["aws-waf-token"],
      header: ["x-amzn-requestid", "x-amzn-errortype", "x-amzn-waf-*"],
    },
    confidenceRules: { strong: 2, weak: 1 },
  },
  {
    id: "datadome_probable",
    detectors: {
      body: ["DataDome"],
      cookie: ["datadome"],
    },
    confidenceRules: { strong: 2, weak: 1 },
    fallbackWhenChallenge: ["playwright_real_chrome"],
  },
  {
    id: "perimeterx_human",
    detectors: {
      body: ["px-captcha", "Press & Hold to confirm you are a human"],
      cookie: ["_px3", "_pxhd", "_px2", "pxcts"],
    },
    confidenceRules: { strong: 2, weak: 1 },
    fallbackWhenChallenge: ["playwright_real_chrome"],
  },
  {
    id: "unknown_challenge",
    detectors: {},
    confidenceRules: { strong: 0, weak: 0 },
    fallbackWhenChallenge: ["playwright_mcp", "playwright_real_chrome"],
  },
] as const satisfies readonly WafProfile[];

import type { WafProfile } from "./waf-profiles.ts";

export const DEFAULT_WAF_PROFILES = [
  {
    confidenceRules: { strong: 2, weak: 1 },
    detectors: {
      body: ["sec-if-cpt-container", "Powered and protected by Akamai"],
      cookie: ["_abck", "bm_sz", "ak_bmsc", "bm_sv", "bm_so"],
      header: ["X-Akamai-*"],
      server_contains: ["AkamaiGHost"],
    },
    fallbackWhenChallenge: ["curl_grid_exhaust", "playwright_real_chrome"],
    id: "akamai_bot_manager",
  },
  {
    confidenceRules: { strong: 2, weak: 1 },
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
    fallbackWhenChallenge: ["playwright_mcp", "playwright_real_chrome"],
    id: "cloudflare_turnstile",
  },
  {
    confidenceRules: { strong: 2, weak: 1 },
    detectors: {
      body: ["The requested URL was rejected", "support ID is:"],
      cookie: ["BigIPServer", "TS01*", "F5_*"],
    },
    id: "f5_big_ip",
  },
  {
    confidenceRules: { strong: 2, weak: 1 },
    detectors: {
      cookie: ["aws-waf-token"],
      header: ["x-amzn-requestid", "x-amzn-errortype", "x-amzn-waf-*"],
    },
    id: "aws_waf",
  },
  {
    confidenceRules: { strong: 2, weak: 1 },
    detectors: {
      body: ["DataDome"],
      cookie: ["datadome"],
    },
    fallbackWhenChallenge: ["playwright_real_chrome"],
    id: "datadome_probable",
  },
  {
    confidenceRules: { strong: 2, weak: 1 },
    detectors: {
      body: ["px-captcha", "Press & Hold to confirm you are a human"],
      cookie: ["_px3", "_pxhd", "_px2", "pxcts"],
    },
    fallbackWhenChallenge: ["playwright_real_chrome"],
    id: "perimeterx_human",
  },
  {
    confidenceRules: { strong: 0, weak: 0 },
    detectors: {},
    fallbackWhenChallenge: ["playwright_mcp", "playwright_real_chrome"],
    id: "unknown_challenge",
  },
] as const satisfies readonly WafProfile[];

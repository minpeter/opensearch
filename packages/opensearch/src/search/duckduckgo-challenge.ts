import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

// DuckDuckGo's result endpoints (links/html) gate suspicious clients behind a
// JS proof-of-work: a 202 body that computes `jsa` (partly from how an HTML
// parser normalizes malformed tags) and calls DDG.deep.initialize(...). We solve
// it headlessly with jsdom (already a dependency) + a locked-down vm sandbox,
// then resubmit with the computed token.
const CHALLENGE_MARKER = "DDG.deep.initialize";
const CHALLENGE_MAX_BYTES = 50_000;
const CHALLENGE_TIMEOUT_MS = 1000;
const CAPTURED_PATTERN = /^0&jsa_hash=[a-f0-9]+&jsa=-?\d+$/;
const LEADING_TOKEN_PREFIX = /^0&/;

const VQD_PATTERNS = [
  /vqd="([^"]+)"/,
  /vqd='([^']+)'/,
  /"vqd":"([^"]+)"/,
  /vqd=([\d-][\w-]*)&/,
] as const;

export function extractDuckDuckGoVqd(html: string): string | null {
  for (const pattern of VQD_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function isDuckDuckGoChallenge(body: string): boolean {
  return body.includes(CHALLENGE_MARKER);
}

/**
 * Compute the proof-of-work token by running DDG's challenge script in a
 * locked-down vm context whose only globals are a jsdom `document` (for the
 * HTML-normalization length math) and a DDG stub that captures the result.
 * eval/Function are disabled, the body is size-capped, and execution is
 * time-boxed. Returns the `jsa_hash=...&jsa=...` query fragment, or null if the
 * body is not a recognizable challenge or the output fails validation.
 */
export function solveDuckDuckGoChallenge(challenge: string): string | null {
  if (
    !isDuckDuckGoChallenge(challenge) ||
    challenge.length > CHALLENGE_MAX_BYTES
  ) {
    return null;
  }

  const dom = new JSDOM("<!DOCTYPE html><body></body>");
  let captured: unknown = null;
  const sandbox = {
    DDG: {
      deep: {
        initialize: (value: unknown) => {
          captured = value;
        },
      },
    },
    document: dom.window.document,
  };

  try {
    runInNewContext(challenge, sandbox, {
      contextCodeGeneration: { strings: false, wasm: false },
      timeout: CHALLENGE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (typeof captured !== "string" || !CAPTURED_PATTERN.test(captured)) {
    return null;
  }
  return captured.replace(LEADING_TOKEN_PREFIX, "");
}

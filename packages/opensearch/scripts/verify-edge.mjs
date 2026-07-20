// Cloudflare Workers safety gate for the edge entry (out/index.js).
//
// Bundles the built edge entry under the worker/browser resolve conditions that
// Wrangler/workerd use, then asserts the resulting module graph never reaches a
// Node-only dependency or a STATIC `node:` builtin import. Run after `tsup`.
//
// We deliberately do NOT grep the source for `new Function` (ajv ships it but
// never compiles once the cfworker validator is injected) and we allow DYNAMIC
// `import("node:...")` (pkce-challenge gates it behind globalThis.crypto, so it
// never executes on Workers). Only the static import graph is load-bearing.
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const ENTRY = fileURLToPath(new URL("../out/index.js", import.meta.url));

// Heavy / Node-coupled modules that the edge entry must never pull in.
const BANNED_INPUTS = [
  /\/jsdom\//,
  /\/unpdf\//,
  /\/turndown\//,
  /@mozilla\/readability\//,
  /\/undici\//,
  /\/local\.[cm]?js$/,
  /\/duckduckgo\.[cm]?js$/,
];

const BANNED_GLOBAL_PATTERNS = [
  {
    name: "Buffer",
    pattern: /\bBuffer\b/,
  },
];

const STATIC_IMPORT_KINDS = new Set(["import-statement", "require-call"]);

const result = await build({
  bundle: true,
  conditions: ["workerd", "worker", "browser"],
  entryPoints: [ENTRY],
  external: ["node:*"],
  format: "esm",
  logLevel: "silent",
  metafile: true,
  platform: "browser",
  write: false,
});

const inputs = Object.keys(result.metafile.inputs);

const heavyLeaks = inputs.filter((path) =>
  BANNED_INPUTS.some((pattern) => pattern.test(path))
);

const bundledCode = result.outputFiles.map((file) => file.text).join("\n");
const rawBytes = result.outputFiles.reduce(
  (total, file) => total + file.contents.byteLength,
  0
);
const gzipBytes = result.outputFiles.reduce(
  (total, file) => total + gzipSync(file.contents).byteLength,
  0
);
const globalLeaks = BANNED_GLOBAL_PATTERNS.filter(({ pattern }) =>
  pattern.test(bundledCode)
).map(({ name }) => name);

const staticNodeLeaks = [];
for (const [file, info] of Object.entries(result.metafile.inputs)) {
  for (const imported of info.imports ?? []) {
    if (
      imported.path.startsWith("node:") &&
      STATIC_IMPORT_KINDS.has(imported.kind)
    ) {
      staticNodeLeaks.push(`${imported.path}  (static import in ${file})`);
    }
  }
}

if (
  heavyLeaks.length > 0 ||
  staticNodeLeaks.length > 0 ||
  globalLeaks.length > 0
) {
  console.error("EDGE LEAK: out/index.js is not Cloudflare Workers-safe:");
  for (const path of heavyLeaks) {
    console.error(`  heavy dependency bundled: ${path}`);
  }
  for (const leak of staticNodeLeaks) {
    console.error(`  static node: import: ${leak}`);
  }
  for (const leak of globalLeaks) {
    console.error(`  node global referenced: ${leak}`);
  }
  process.exit(1);
}

console.log(
  `edge entry clean: ${inputs.length} modules, ${rawBytes} raw bytes, ${gzipBytes} gzip bytes under [workerd,worker,browser] - ` +
    "no jsdom / unpdf / turndown / readability / undici / local / duckduckgo, no static node: imports, and no node globals."
);

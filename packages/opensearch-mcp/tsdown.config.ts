import { defineConfig } from "tsdown";

export default defineConfig({
  banner: {
    js: "#!/usr/bin/env node",
  },
  clean: true,
  deps: {
    neverBundle: ["@minpeter/opensearch"],
  },
  entry: ["src/index.ts"],
  fixedExtension: false,
  format: ["esm"],
  // Keep property names intact so bundled Zod/MCP schema introspection
  // continues to emit full tool input schemas in tools/list.
  minify: false,
  outDir: "out",
  sourcemap: true,
});

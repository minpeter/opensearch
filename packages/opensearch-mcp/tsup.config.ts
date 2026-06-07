import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  external: ["@minpeter/opensearch"],
  format: ["esm"],
  outDir: "out",
  sourcemap: true,
  // Keep property names intact so bundled Zod/MCP schema introspection
  // continues to emit full tool input schemas in tools/list.
  minify: false,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

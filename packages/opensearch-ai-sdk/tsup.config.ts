import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/node.ts"],
  external: ["ai", "@minpeter/opensearch", "@minpeter/opensearch/node"],
  format: ["esm"],
  minify: false,
  outDir: "out",
  sourcemap: true,
});

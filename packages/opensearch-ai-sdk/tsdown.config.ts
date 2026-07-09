import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ["ai", "@minpeter/opensearch", "@minpeter/opensearch/node"],
  },
  dts: true,
  entry: ["src/index.ts", "src/node.ts"],
  fixedExtension: false,
  format: ["esm"],
  minify: false,
  outDir: "out",
  sourcemap: true,
  tsconfig: "tsconfig.build.json",
});

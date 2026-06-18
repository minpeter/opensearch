import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/node.ts"],
  external: ["playwright", "wreq-js"],
  format: ["esm"],
  minify: false,
  outDir: "out",
  splitting: false,
  sourcemap: true,
});

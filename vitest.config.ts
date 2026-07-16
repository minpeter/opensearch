import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        branches: 65,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    exclude: ["**/.omx/**", "**/node_modules/**", "**/ref-duckduckgo-mcp/**"],
  },
});

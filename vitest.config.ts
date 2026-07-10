import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    maxWorkers: 4,
    testTimeout: 10_000,
    exclude: ["convex/**/*.integration.test.ts", "**/node_modules/**", "**/.git/**"],
    globals: true,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

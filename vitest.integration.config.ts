import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // These tests race real database sessions; running files in parallel
    // against one schema would make failures ambiguous.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});

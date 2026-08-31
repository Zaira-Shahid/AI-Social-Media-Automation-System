import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Separate config: rules tests need the Firestore emulator running, so they
 * are not part of the default unit run.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

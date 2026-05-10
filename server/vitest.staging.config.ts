import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.staging" });

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/staging/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: ["tests/integration/**", "tests/staging/**", "node_modules/**"],
  },
});

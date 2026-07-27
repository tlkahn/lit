import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    fs: {
      allow: [__dirname],
    },
  },
  test: {
    root: __dirname,
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "src/test/setup.ts")],
    css: true,
    exclude: ["e2e/**", "node_modules/**", "server/**", ".claude/worktrees/**"],
    benchmark: {
      include: ["src/**/*.bench.{ts,tsx}"],
    },
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const exclude = ["e2e/**", "node_modules/**", "server/**", ".claude/worktrees/**"];

// Two projects so the default `bun run test` stays fast and reliable:
// - "unit": logic-level tests (lib/stores/data/test) — light on jsdom.
// - "ui": component/editor/hook tests that render React + CodeMirror in jsdom.
//   Running all ~250 files in one pass piles up jsdom+CM environments and can
//   hang the worker (see doc/reports/2026-07-14-issue-886-block-anchor-fragment-fix.md).
// `bun run test` → unit only; `bun run test:ui` → ui only; `bun run test:full` → both.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    exclude,
    benchmark: {
      include: ["src/**/*.bench.{ts,tsx}"],
    },
    // Read by the vmThreads pool (used by the "ui" project) from the ROOT
    // config only — vitest ignores project-level memoryLimit. Workers are
    // recycled once they cross this, preventing jsdom+CM memory pile-up.
    poolOptions: {
      forks: {
        execArgv: ["--prof"],
      },
      vmThreads: {
        memoryLimit: "1GB",
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/{lib,stores,data,test}/**/*.test.{ts,tsx}"],
          exclude,
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          include: ["src/{components,editor,hooks}/**/*.test.{ts,tsx}", "src/App.test.tsx"],
          exclude,
          // jsdom+CodeMirror environments accumulate memory across files and can
          // hang a long-lived worker. vmThreads shares workers via VM contexts
          // (fast startup) and recycles any worker that crosses the root-level
          // poolOptions.vmThreads.memoryLimit.
          pool: "vmThreads",
        },
      },
    ],
  },
});

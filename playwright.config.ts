import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: "html",
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: ["--enable-webgl-swiftshader"],
    },
  },
  webServer: {
    command: "bun run dev",
    port: 1420,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

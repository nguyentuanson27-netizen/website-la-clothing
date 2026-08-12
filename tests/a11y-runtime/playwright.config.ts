import { defineConfig, devices } from "@playwright/test";
import { screenReaderConfig } from "@guidepup/playwright";

export default defineConfig({
  ...screenReaderConfig,
  testDir: ".",
  testMatch: ["admin-editor.spec.ts", "checkout.spec.ts"],
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "line",
  projects: [
    {
      name: "chromium-voiceover-mobile",
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["p18-final-qa.spec.ts"],
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "line",
  projects: [
    {
      name: "chromium-p18-final-qa",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";
import { screenReaderConfig } from "@guidepup/playwright";

const adminDesktopTests = [
  "admin-bulk-operations.spec.ts",
  "admin-commerce-v3.spec.ts",
  "admin-editor.spec.ts",
  "admin-editor-compact.spec.ts",
];

export default defineConfig({
  ...screenReaderConfig,
  testDir: ".",
  testMatch: [
    "admin-bulk-operations.spec.ts",
    "admin-bulk-status.spec.ts",
    "admin-collections.spec.ts",
    "admin-commerce-v3.spec.ts",
    "admin-editor.spec.ts",
    "admin-editor-compact.spec.ts",
    "checkout.spec.ts",
    "collection-breadcrumb.spec.ts",
    "collection-landing.spec.ts",
    "discovery.spec.ts",
    "editorial.spec.ts",
    "footer-support.spec.ts",
    "homepage-taxonomy.spec.ts",
    "pdp-language.spec.ts",
    "related-products.spec.ts",
    "storefront-commerce.spec.ts",
    "storefront-composite.spec.ts",
    "storefront-media.spec.ts",
    "tracking.spec.ts",
  ],
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "line",
  projects: [
    {
      name: "chromium-voiceover-admin-desktop",
      testMatch: adminDesktopTests,
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "chromium-voiceover-mobile",
      testIgnore: adminDesktopTests,
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});

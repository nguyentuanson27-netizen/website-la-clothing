import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

/**
 * W15a keeps an explicit map from each dedicated SEO HTTP smoke to the gate that runs it. The map
 * is only useful while it is true, so this asserts the two facts it rests on: every listed script
 * still exists, and every one of them is still reached by a CI gate.
 *
 * It runs no server of its own — the smokes themselves already do that once each, and duplicating
 * them here would double the most expensive part of the suite to prove something a file read
 * settles.
 */
const DEDICATED_SEO_SMOKES = [
  "search-exposure-http-smoke.ts",
  "structured-data-http-smoke.ts",
  "product-metadata-http-smoke.ts",
  "oai-robots-http-smoke.ts",
  "product-slug-http-smoke.ts",
] as const;

/** The harness that turns those scripts into `pnpm test` subtests. */
const HARNESS = new URL("./product-slug-http.test.ts", import.meta.url);
const COVERAGE_MAP = new URL("../../docs/audits/seo-runtime-coverage-w15a.md", import.meta.url);

test("W15a every dedicated SEO HTTP smoke named by the coverage map still exists", async () => {
  for (const script of DEDICATED_SEO_SMOKES) {
    await access(new URL(`../../scripts/${script}`, import.meta.url));
  }
});

test("W15a every dedicated SEO HTTP smoke is reached by a CI gate rather than only existing", async () => {
  const harness = await readFile(HARNESS, "utf8");

  for (const script of DEDICATED_SEO_SMOKES) {
    assert.ok(
      harness.includes(`scripts/${script}`),
      `${script} must stay wired into pnpm test, or the coverage map must be updated to say what replaced it`,
    );
  }
});

test("W15a the coverage map documents every dedicated SEO HTTP smoke", async () => {
  const map = await readFile(COVERAGE_MAP, "utf8");

  for (const script of DEDICATED_SEO_SMOKES) {
    assert.ok(map.includes(script), `${script} must appear in the W15a coverage map`);
  }
});

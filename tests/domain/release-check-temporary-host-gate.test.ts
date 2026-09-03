/**
 * W15b signal 1 — the negative `release:check` case.
 *
 * The temporary-host indexing block is enforced in `validateSearchExposureForRelease`, and the
 * domain suite already proves that function refuses the configuration. What the U5 coverage
 * inventory found missing is a gate on the **command a deployment actually runs**: CI's release
 * preflight step only ever exercises the passing configuration, so a regression that removed the
 * temporary-host branch would leave every existing gate green and let a mistaken
 * `SEARCH_INDEXING_ENABLED=true` reach production preflight unopposed.
 *
 * This spawns `scripts/release-readiness.ts` — the exact entry point behind `pnpm release:check` —
 * rather than importing the validator, because the gap is the wiring, not the rule.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const releaseCheckScript = fileURLToPath(
  new URL("../../scripts/release-readiness.ts", import.meta.url),
);

const TEMPORARY_PRODUCTION_HOST = "la.lanadesign.vn";
const DATABASE_PASSWORD = "super-secret-release-password";

/**
 * Constructed rather than inherited. An ambient `APP_DOMAIN` or `SEARCH_INDEXING_ENABLED` from a
 * developer's shell would silently decide the outcome of the very assertion this test exists for.
 */
function releaseEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    // `NODE_ENV` is part of this repo's augmented `ProcessEnv`, so it is carried through rather
    // than dropped; everything else is stated explicitly.
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH ?? "",
    DATABASE_URL: `postgresql://release_user:${DATABASE_PASSWORD}@db.internal:5432/la_clothing`,
    BETTER_AUTH_SECRET: "release-only-secret-0123456789abcdef",
    BETTER_AUTH_IP_HEADER: "cf-connecting-ip",
    PANCAKE_API_KEY: "super-secret-pancake-key",
    PANCAKE_SHOP_ID: "920007",
    ...overrides,
  };
}

function runReleaseCheck(overrides: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", releaseCheckScript],
    { env: releaseEnvironment(overrides), encoding: "utf8" },
  );
}

test("W15b release:check fails closed when the temporary production host requests indexing", () => {
  const result = runReleaseCheck({
    APP_DOMAIN: TEMPORARY_PRODUCTION_HOST,
    BETTER_AUTH_URL: `https://${TEMPORARY_PRODUCTION_HOST}`,
    SEARCH_INDEXING_ENABLED: "true",
  });

  assert.notEqual(result.status, 0, `release:check must fail for the temporary host\n${result.stderr}`);
  // Named specifically so an unrelated failure — a missing Pancake key, say — cannot be mistaken
  // for this gate holding.
  assert.match(
    result.stderr,
    /Search indexing cannot be enabled on the temporary production storefront origin/,
    `release:check must fail for the indexing reason, not incidentally\n${result.stderr}`,
  );
  assert.equal(result.stdout.includes('"ok": true'), false, "a refused preflight must print no success summary");
  assert.equal(result.stdout.includes('"ok":true'), false, "a refused preflight must print no success summary");
});

test("W15b the refused release:check leaks no credentials in its failure output", () => {
  const result = runReleaseCheck({
    APP_DOMAIN: TEMPORARY_PRODUCTION_HOST,
    BETTER_AUTH_URL: `https://${TEMPORARY_PRODUCTION_HOST}`,
    SEARCH_INDEXING_ENABLED: "true",
  });

  const output = `${result.stdout}${result.stderr}`;
  for (const secret of [DATABASE_PASSWORD, "super-secret-pancake-key", "release-only-secret-0123456789abcdef"]) {
    assert.equal(output.includes(secret), false, `release:check output must not echo ${secret.slice(0, 12)}…`);
  }
});

test("W15b the same host still passes preflight while indexing stays disabled", () => {
  // The gate must refuse the requested-indexing configuration specifically. If it refused the
  // temporary host outright, production — which runs on that host today — could never deploy.
  const result = runReleaseCheck({
    APP_DOMAIN: TEMPORARY_PRODUCTION_HOST,
    BETTER_AUTH_URL: `https://${TEMPORARY_PRODUCTION_HOST}`,
    SEARCH_INDEXING_ENABLED: "false",
  });

  assert.equal(result.status, 0, `the temporary host must still deploy with indexing off\n${result.stderr}`);
  assert.match(result.stdout, /"searchIndexingEnabled":\s*false/);
});

import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };
type NextConfigLike = { headers?: () => Promise<HeaderRule[]> };

async function loadHeaderRules(): Promise<HeaderRule[]> {
  const configUrl = pathToFileURL(resolve("next.config.mjs")).href;
  const { default: nextConfig } = (await import(configUrl)) as { default: NextConfigLike };

  assert.equal(typeof nextConfig.headers, "function");
  return nextConfig.headers!();
}

test("Next.js applies the storefront security-header baseline to every route", async () => {
  const rules = await loadHeaderRules();
  const globalRule = rules.find(({ source }) => source === "/(.*)");

  assert.ok(globalRule);

  const headers = new Map(globalRule.headers.map(({ key, value }) => [key, value]));

  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(
    headers.get("Permissions-Policy"),
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );

  const csp = headers.get("Content-Security-Policy");
  assert.ok(csp);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildPublicBrandFacts } from "../../src/content/public-brand-facts.ts";

/**
 * W13A is a historical inventory of which evergreen-page facts the repository owned at that time and
 * which still required an owner decision. The current owner decisions live in the master roadmap and
 * owner-facts source; keep historical evidence distinct from current implementation state.
 */
const INVENTORY = new URL("../../docs/audits/first-party-content-facts-w13a.md", import.meta.url);
const MASTER_TODO = new URL("../../tasks/growth-commerce-master-todo.md", import.meta.url);

const AUTHORITATIVE_FACT_KEYS = [
  "brandName",
  "brandSummary",
  "checkoutAccount",
  "orderTracking",
  "paymentMethod",
  "serverVerification",
  "shipping",
] as const;

/**
 * Facts W13A classified as owner-blocked. The owner decisions are now resolved, but U32b/U33 remain
 * implementation work, so a docs-only reconciliation must not silently add these fields to the
 * existing runtime fact source.
 */
const HISTORICALLY_OWNER_BLOCKED_FACT_KEYS = [
  "returnPolicy",
  "returnWindowDays",
  "exchangePolicy",
  "refundMethod",
  "contactPhone",
  "contactEmail",
  "storeAddress",
  "businessHours",
  "sizeChart",
  "deliveryEstimate",
  "legalEntity",
  "taxCode",
] as const;

const policy = {
  feeVnd: 30_000,
  freeShippingSubtotalVnd: 1_000_000,
  freeShippingMinQuantity: 3,
} as const;

test("W13A the authoritative brand-fact source exposes exactly the inventoried runtime facts", () => {
  const facts = buildPublicBrandFacts(policy);

  assert.deepEqual(Object.keys(facts).sort(), [...AUTHORITATIVE_FACT_KEYS]);
});

test("owner reconciliation does not implicitly implement U32b/U33 facts in the runtime fact source", () => {
  const facts = buildPublicBrandFacts(policy) as Record<string, unknown>;

  for (const key of HISTORICALLY_OWNER_BLOCKED_FACT_KEYS) {
    assert.equal(
      key in facts,
      false,
      `${key} needs focused U32b/U33 implementation before it appears in the runtime fact source`,
    );
  }
});

test("W13A historical inventory still documents every fact it owned or classified as blocked", async () => {
  const inventory = await readFile(INVENTORY, "utf8");

  for (const key of [...AUTHORITATIVE_FACT_KEYS, ...HISTORICALLY_OWNER_BLOCKED_FACT_KEYS]) {
    assert.ok(inventory.includes(key), `${key} must remain documented in the historical W13A inventory`);
  }
});

test("current roadmap preserves W13A history while recording the resolved owner decisions", async () => {
  const [inventory, masterTodo] = await Promise.all([
    readFile(INVENTORY, "utf8"),
    readFile(MASTER_TODO, "utf8"),
  ]);

  assert.match(inventory, /\| \*\*B6\*\* \| About(?:\/brand\/legal)? facts .*\| U33 \(About page\) \|/);
  assert.match(inventory, /For each of About, Returns, Shipping delivery terms, Size Guide and Contact:/);

  assert.match(
    masterTodo,
    /\*\*U33\*\*[^\n]+\*\*B1–B4 and B6 are RESOLVED; U33 is owner-unblocked but not implemented\.\*\*/,
  );
  assert.match(
    masterTodo,
    /\| \*\*B6\*\* \| \*\*RESOLVED FOR MINIMAL ABOUT\*\*[^\n]+\| U33 About owner-unblocked \|/,
  );
  // U29 implemented B5's publish enforcement, so the old "implementation open" wording no longer
  // holds. What must not regress is the record itself: the owner decision stays resolved and
  // pair-level, and the part that is genuinely still open — the slug/path cleanup, which needs
  // real-catalog evidence — stays marked open rather than being closed by the enforcement landing.
  assert.match(
    masterTodo,
    /\*\*U29\*\*[^\n]+\*\*B5 enforcement is IMPLEMENTED; the slug\/path metadata cleanup itself remains OPEN pending real-catalog evidence\.\*\*/,
  );
  assert.match(
    masterTodo,
    /\*\*U29\*\*[^\n]+pair-level[^\n]*`\(seoTitle, seoDescription\)`/,
  );
  assert.match(masterTodo, /\*\*U29\*\*[^\n]+Real-catalog verification of slug-free copy is PENDING/);
  assert.match(
    masterTodo,
    /\| \*\*B5\*\* \| \*\*RESOLVED\*\* — pair-level `\(seoTitle, seoDescription\)` uniqueness among published products; drafts may be missing\/duplicate; collision blocks publish \|/,
  );
});

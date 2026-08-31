import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildPublicBrandFacts } from "../../src/content/public-brand-facts.ts";

/**
 * W13A inventories which evergreen-page facts the repository actually owns and which are blocked on
 * an owner decision. The inventory is only useful while it matches the code, so this asserts the two
 * directions: the authoritative fact source has not quietly grown a fact nobody approved, and the
 * document still describes every fact it does expose.
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
 * Facts an evergreen About / Returns / Shipping / Size Guide / Contact page needs that no
 * source-of-truth in this repository provides. A coding agent must never invent them, so their
 * absence here is the assertion.
 */
const OWNER_BLOCKED_FACT_KEYS = [
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

test("W13A the authoritative brand-fact source exposes exactly the inventoried facts", () => {
  const facts = buildPublicBrandFacts(policy);

  assert.deepEqual(Object.keys(facts).sort(), [...AUTHORITATIVE_FACT_KEYS]);
});

test("W13A no owner-blocked business fact has been invented in the fact source", () => {
  const facts = buildPublicBrandFacts(policy) as Record<string, unknown>;

  for (const key of OWNER_BLOCKED_FACT_KEYS) {
    assert.equal(
      key in facts,
      false,
      `${key} requires owner-approved source content and must not appear before then`,
    );
  }
});

test("W13A the inventory documents every fact the repository owns and every blocked one", async () => {
  const inventory = await readFile(INVENTORY, "utf8");

  for (const key of [...AUTHORITATIVE_FACT_KEYS, ...OWNER_BLOCKED_FACT_KEYS]) {
    assert.ok(inventory.includes(key), `${key} must appear in the W13A inventory`);
  }
});

test("W13A About has an explicit owner-decision gate everywhere U33 consumes the inventory", async () => {
  const [inventory, masterTodo] = await Promise.all([
    readFile(INVENTORY, "utf8"),
    readFile(MASTER_TODO, "utf8"),
  ]);

  assert.match(inventory, /\| \*\*B6\*\* \| About(?:\/brand\/legal)? facts .*\| U33 \(About page\) \|/);
  assert.match(inventory, /For each of About, Returns, Shipping delivery terms, Size Guide and Contact:/);
  assert.match(masterTodo, /\*\*U33\*\*[^\n]+Blocked by B1–B4 and B6/);
  assert.match(masterTodo, /\| \*\*B6\*\* \| About(?:\/brand\/legal)? facts .*\| U33 \(About page\) \|/);

  assert.match(masterTodo, /\| \*\*B5\*\* \| Metadata uniqueness:/, "B5 metadata gate must remain unchanged");
});

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

/**
 * The audit is what a later agent reads before starting the next U33 slice. If its top-level status
 * or its per-page snapshot still reads as owner-blocked, that agent stops work the owner has already
 * unblocked. So the record has to do two things at once: state the present truth up front, and keep
 * the U6-time evidence clearly marked as history rather than deleting it.
 */
test("W13A states the current truth and marks the U6-time snapshot as historical", async () => {
  const inventory = await readFile(INVENTORY, "utf8");

  const [status] = inventory.split("## Classification");
  assert.ok(status, "the audit must open with a status block");

  // The stale top-level verdict must not survive: it contradicted every update section below it.
  assert.doesNotMatch(
    status,
    /Status: \*\*BLOCKED/,
    "the top-level status must state the current truth, not the U6-time verdict",
  );
  assert.match(status, /Status: \*\*CURRENT — B1–B4 and B6 are RESOLVED/);
  assert.match(status, /U33a and U33b are\nimplemented/);

  // B3 is resolved, so the Size Guide is implementation work. An agent that reads "owner-blocked"
  // here stops U33c for a decision that has already been made.
  assert.match(
    status,
    /\| Size Guide \| BLOCKED on B3 \| \*\*Owner-unblocked, not yet built\.\*\*[^\n]*U33c implementation work, not an owner gate/,
  );
  // U32b is implemented; the audit used to call the same enrichment blocked.
  assert.match(status, /\| `Organization` structured data \|[^\n]*\*\*Enriched \(U32b\)\*\*/);
  // The surfaces that genuinely have no approved facts must stay recorded as blocked, or a later
  // reconciliation reads "everything is resolved" and authors a privacy policy from nothing.
  assert.match(status, /§15 policy surfaces[^\n]*\*\*Still blocked — no approved facts exist\.\*\*/);

  // Keeping the evidence is the point; presenting it as current status is the bug.
  assert.match(inventory, /## Per-page inventory — the U6-time snapshot \(historical\)/);
  assert.match(inventory, /## Consequence for structured data — resolved by U32b/);

  // Every retained U6-time verdict must carry both its historical label and a superseded note, so
  // no page section can be read as a live blocker.
  const retainedVerdicts = inventory.match(/`BLOCKED — OWNER FACT\/APPROVAL REQUIRED`/g) ?? [];
  const historicalLabels = inventory.match(/\*\(U6-time verdict\)\*/g) ?? [];
  const supersededNotes = inventory.match(/\*\*Superseded/g) ?? [];
  assert.equal(retainedVerdicts.length, 5, "the five U6-time page verdicts are the historical record");
  assert.equal(historicalLabels.length, retainedVerdicts.length);
  assert.equal(supersededNotes.length, retainedVerdicts.length);
});

test("current roadmap preserves W13A history while recording the resolved owner decisions", async () => {
  const [inventory, masterTodo] = await Promise.all([
    readFile(INVENTORY, "utf8"),
    readFile(MASTER_TODO, "utf8"),
  ]);

  assert.match(inventory, /\| \*\*B6\*\* \| About(?:\/brand\/legal)? facts .*\| U33 \(About page\) \|/);
  assert.match(inventory, /For each of About, Returns, Shipping delivery terms, Size Guide and Contact:/);

  // U33a built About and Contact, so "not implemented" no longer holds for the unit as a whole.
  // What must not regress is the distinction the record draws: the owner decisions stay resolved,
  // the pages that are built say so, and the pages whose facts do not exist stay marked open rather
  // than being closed by the first slice landing.
  assert.match(
    masterTodo,
    /\*\*U33\*\*[^\n]+\*\*B1–B4 and B6 are RESOLVED; U33 is partly implemented[^\n]*\.\*\*/,
  );
  assert.match(masterTodo, /\*\*U33a\*\*[^\n]+About \+ Contact/);
  assert.match(masterTodo, /- \[x\] \*\*U33b\*\*[^\n]+Returns \+ Shipping\/Payment/);
  // B4 keeps the server-owned policy as the pricing authority; the record has to keep saying so, or
  // a later slice copies a fee into the content module and the pages start contradicting checkout.
  assert.match(masterTodo, /\*\*U33b\*\*[^\n]+shipping price is deliberately not in the content module/);
  assert.match(masterTodo, /- \[ \] \*\*U33c\*\*[^\n]+Size Guide/);
  // The §15 surfaces with no approved facts must stay recorded as unbuilt, not quietly dropped.
  assert.match(masterTodo, /\*\*U33a\*\*[^\n]+no approved facts yet\*\*; they stay unbuilt and unlinked/);
  assert.match(
    masterTodo,
    /\| \*\*B6\*\* \| \*\*RESOLVED FOR MINIMAL ABOUT\*\*[^\n]+\| U33 About owner-unblocked \|/,
  );
  // U29 implemented B5's publish enforcement, so the old "implementation open" wording no longer
  // holds. What must not regress is the record itself: the owner decision stays resolved and
  // pair-level, and the parts that are genuinely still open stay marked open rather than being
  // closed by the enforcement landing. W2a's exit path asks for enforcement "in the database and
  // in the admin publish path" — U29 met only the second, and the record has to say which, or a
  // later reader takes a cooperative application-level protocol for a database-owned invariant.
  assert.match(
    masterTodo,
    /\*\*U29\*\*[^\n]+\*\*B5 enforcement is IMPLEMENTED at the admin publish path; the W2a database-level enforcement condition and the slug\/path metadata cleanup itself remain OPEN\.\*\*/,
  );
  assert.match(
    masterTodo,
    /\*\*U29\*\*[^\n]+The application owns this invariant, not the database/,
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

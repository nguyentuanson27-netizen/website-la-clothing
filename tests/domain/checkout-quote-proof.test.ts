import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RENDERED_QUOTE_PROOF_BYTES,
  issueRenderedQuoteProof,
  verifyRenderedQuoteProof,
  type RenderedQuoteProofFacts,
} from "../../src/commerce/checkout-quote-proof.ts";

const secret = "test-server-secret-at-least-32-characters-long";
const otherSecret = "another-server-secret-at-least-32-characters-long";
const cartId = "0f8d3c2a-4b1e-4d7a-9c6b-2e5f1a8d4c30";
const otherCartId = "9a1b7c6d-3e2f-4a5b-8c9d-1e2f3a4b5c6d";

const quote: RenderedQuoteProofFacts = {
  items: [
    { variantExternalId: "var-b", quantity: 2, unitPriceVnd: 400_000 },
    { variantExternalId: "var-a", quantity: 1, unitPriceVnd: 650_000 },
  ],
  merchandiseSubtotalVnd: 1_450_000,
  shippingFeeVnd: 30_000,
  totalVnd: 1_480_000,
  totalQuantity: 3,
};

function issue(overrides: Partial<Parameters<typeof issueRenderedQuoteProof>[0]> = {}) {
  return issueRenderedQuoteProof({ quote, cartId, secret, ...overrides });
}

function verify(overrides: Partial<Parameters<typeof verifyRenderedQuoteProof>[0]> = {}) {
  return verifyRenderedQuoteProof({
    proof: issue(),
    cartId,
    currentQuote: quote,
    secret,
    ...overrides,
  });
}

test("P9a a proof issued for the current quote and cart verifies", () => {
  assert.deepEqual(verify(), { ok: true });
});

test("P9a canonicalization is deterministic and order-independent", () => {
  assert.equal(issue(), issue(), "same facts must produce identical proof bytes");

  const reordered = {
    ...quote,
    items: [...quote.items].reverse(),
  };
  assert.equal(
    issue({ quote: reordered }),
    issue(),
    "item order must not change the canonical payload",
  );
});

test("P9a the proof is ASCII base64url and carries a format/version fact", () => {
  const proof = issue();
  assert.match(proof, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = Buffer.from(proof.split(".")[0]!, "base64url").toString("utf8");
  assert.match(payload, /^laq1\|/, "payload must open with the format/version fact");
});

test("P9a browser-visible proof bytes never carry the raw HttpOnly cart id", () => {
  const proof = issue();
  assert.equal(proof.includes(cartId), false);

  const payload = Buffer.from(proof.split(".")[0]!, "base64url").toString("utf8");
  assert.equal(payload.includes(cartId), false, "decoded payload must not leak the cart UUID");
  assert.equal(payload.includes(cartId.replace(/-/g, "")), false);
  // The quote facts the payload is allowed to carry are still all present.
  assert.equal(payload.includes("var-a"), true);
  assert.equal(payload.includes("650000"), true);
});

test("P9a a proof bound to another cart fails closed", () => {
  assert.deepEqual(verify({ cartId: otherCartId }), {
    ok: false,
    reason: "PROOF_UNVERIFIED",
  });
});

test("P9a a proof signed with another server secret fails closed", () => {
  assert.deepEqual(verify({ proof: issue({ secret: otherSecret }) }), {
    ok: false,
    reason: "PROOF_UNVERIFIED",
  });
});

test("P9a a tampered payload fails closed rather than re-pricing", () => {
  const [payload64, mac64] = issue().split(".") as [string, string];
  const forged = Buffer.from(
    Buffer.from(payload64, "base64url").toString("utf8").replace("650000", "1"),
    "utf8",
  ).toString("base64url");

  assert.deepEqual(verify({ proof: `${forged}.${mac64}` }), {
    ok: false,
    reason: "PROOF_UNVERIFIED",
  });
});

test("P9a missing or non-string proof fails closed", () => {
  for (const proof of [undefined, null, "", 42, {}, []]) {
    assert.deepEqual(
      verify({ proof }),
      { ok: false, reason: "PROOF_MISSING" },
      `expected PROOF_MISSING for ${JSON.stringify(proof) ?? String(proof)}`,
    );
  }
});

test("P9a malformed proof shapes fail closed", () => {
  for (const proof of ["no-separator", "a.b.c", "!!!.???", ".", "abc.", ".abc"]) {
    const result = verify({ proof });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "PROOF_MALFORMED", `expected PROOF_MALFORMED for ${proof}`);
  }
});

test("P9a the byte ceiling accepts max and rejects max+1 before decode/MAC work", () => {
  assert.equal(MAX_RENDERED_QUOTE_PROOF_BYTES, 16 * 1024);

  const macPart = "B".repeat(43);
  const atMax = `${"A".repeat(MAX_RENDERED_QUOTE_PROOF_BYTES - 1 - macPart.length)}.${macPart}`;
  assert.equal(Buffer.byteLength(atMax, "utf8"), MAX_RENDERED_QUOTE_PROOF_BYTES);

  const atMaxResult = verify({ proof: atMax });
  assert.equal(atMaxResult.ok, false);
  if (atMaxResult.ok) return;
  assert.notEqual(
    atMaxResult.reason,
    "PROOF_OVERSIZED",
    "a proof at exactly the ceiling must reach normal verification",
  );

  assert.deepEqual(verify({ proof: `A${atMax}` }), {
    ok: false,
    reason: "PROOF_OVERSIZED",
  });
});

test("P9a a stale proof reports PRICE_CHANGED against the current quote", () => {
  const staleProof = issue({
    quote: { ...quote, items: [{ variantExternalId: "var-a", quantity: 1, unitPriceVnd: 400_000 }] },
  });

  assert.deepEqual(
    verifyRenderedQuoteProof({
      proof: staleProof,
      cartId,
      currentQuote: {
        ...quote,
        items: [{ variantExternalId: "var-a", quantity: 1, unitPriceVnd: 500_000 }],
      },
      secret,
    }),
    { ok: false, reason: "PRICE_CHANGED" },
  );
});

test("P9a every quote fact is bound, so any single change invalidates the proof", () => {
  const proof = issue();
  const mutations: Array<[string, RenderedQuoteProofFacts]> = [
    ["unit price", { ...quote, items: [{ ...quote.items[0]! }, { ...quote.items[1]!, unitPriceVnd: 650_001 }] }],
    ["quantity", { ...quote, items: [{ ...quote.items[0]!, quantity: 3 }, { ...quote.items[1]! }] }],
    ["variant identity", { ...quote, items: [{ ...quote.items[0]! }, { ...quote.items[1]!, variantExternalId: "var-c" }] }],
    ["merchandise subtotal", { ...quote, merchandiseSubtotalVnd: 1_450_001 }],
    ["shipping fee", { ...quote, shippingFeeVnd: 0 }],
    ["total", { ...quote, totalVnd: 1_480_001 }],
    ["total quantity", { ...quote, totalQuantity: 4 }],
  ];

  for (const [label, currentQuote] of mutations) {
    assert.deepEqual(
      verifyRenderedQuoteProof({ proof, cartId, currentQuote, secret }),
      { ok: false, reason: "PRICE_CHANGED" },
      `changing the ${label} must invalidate the rendered proof`,
    );
  }
});

test("P9a a line count change cannot be smuggled past canonicalization", () => {
  const oneLine = {
    items: [{ variantExternalId: "var-a", quantity: 1, unitPriceVnd: 100_000 }],
    merchandiseSubtotalVnd: 100_000,
    shippingFeeVnd: 0,
    totalVnd: 100_000,
    totalQuantity: 1,
  };
  const twoLines = {
    items: [
      { variantExternalId: "var-a", quantity: 1, unitPriceVnd: 100_000 },
      { variantExternalId: "var-b", quantity: 1, unitPriceVnd: 0o0 + 1 },
    ],
    merchandiseSubtotalVnd: 100_001,
    shippingFeeVnd: 0,
    totalVnd: 100_001,
    totalQuantity: 2,
  };

  assert.notEqual(
    issue({ quote: oneLine }),
    issue({ quote: twoLines }),
    "line cardinality must be part of the canonical payload",
  );
});

test("P9a variant ids containing the field delimiters cannot forge a different quote", () => {
  const injected = {
    items: [{ variantExternalId: "var-a:1:400000|1", quantity: 1, unitPriceVnd: 100_000 }],
    merchandiseSubtotalVnd: 100_000,
    shippingFeeVnd: 0,
    totalVnd: 100_000,
    totalQuantity: 1,
  };
  const benign = {
    items: [{ variantExternalId: "var-a", quantity: 1, unitPriceVnd: 400_000 }],
    merchandiseSubtotalVnd: 100_000,
    shippingFeeVnd: 0,
    totalVnd: 100_000,
    totalQuantity: 1,
  };

  assert.notEqual(
    issue({ quote: injected }),
    issue({ quote: benign }),
    "a delimiter-bearing id must not collide with a different canonical quote",
  );
});

test("P9a issuing refuses facts that are not usable website money", () => {
  const invalid = [
    { ...quote, items: [{ variantExternalId: "var-a", quantity: 0, unitPriceVnd: 1 }] },
    { ...quote, items: [{ variantExternalId: "var-a", quantity: 1, unitPriceVnd: 0 }] },
    { ...quote, items: [{ variantExternalId: "", quantity: 1, unitPriceVnd: 1 }] },
    { ...quote, items: [{ variantExternalId: "var-a", quantity: 1.5, unitPriceVnd: 1 }] },
    { ...quote, totalVnd: Number.NaN },
    { ...quote, merchandiseSubtotalVnd: -1 },
    {
      ...quote,
      items: [
        { variantExternalId: "dupe", quantity: 1, unitPriceVnd: 1 },
        { variantExternalId: "dupe", quantity: 1, unitPriceVnd: 1 },
      ],
    },
  ];

  for (const badQuote of invalid) {
    assert.throws(
      () => issue({ quote: badQuote as RenderedQuoteProofFacts }),
      TypeError,
      `expected issuing to refuse ${JSON.stringify(badQuote.items)}`,
    );
  }
});

test("P9a issuing refuses an unusable cart identity or secret", () => {
  assert.throws(() => issue({ cartId: "" }), TypeError);
  assert.throws(() => issue({ secret: "too-short" }), TypeError);
});

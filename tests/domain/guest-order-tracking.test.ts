import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGuestOrderTrackingInput,
  toGuestOrderPublicStatus,
} from "../../src/commerce/guest-order-tracking.ts";

test("guest order tracking input trims bounded proof fields", () => {
  assert.deepEqual(
    parseGuestOrderTrackingInput({
      orderCode: "  LA-123  ",
      phone: " 0901234567 ",
    }),
    {
      ok: true,
      value: {
        orderCode: "LA-123",
        phone: "0901234567",
      },
    },
  );
});

test("guest order tracking input collapses malformed proof to NOT_FOUND", () => {
  const invalidInputs = [
    null,
    {},
    { orderCode: "", phone: "0901234567" },
    { orderCode: "LA-123", phone: "" },
    { orderCode: 123, phone: "0901234567" },
    { orderCode: "LA-123", phone: 901234567 },
    { orderCode: `LA-${"x".repeat(126)}`, phone: "0901234567" },
    { orderCode: "LA-123", phone: "0".repeat(65) },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(parseGuestOrderTrackingInput(input), {
      ok: false,
      reason: "NOT_FOUND",
    });
  }
});

test("guest order tracking exposes only website-owned public status categories", () => {
  assert.equal(toGuestOrderPublicStatus("DRAFT"), "PROCESSING");
  assert.equal(toGuestOrderPublicStatus("VALIDATING"), "PROCESSING");
  assert.equal(toGuestOrderPublicStatus("POS_SUBMITTING"), "PROCESSING");
  assert.equal(toGuestOrderPublicStatus("CONFIRMED"), "CONFIRMED");
  assert.equal(toGuestOrderPublicStatus("SYNC_UNKNOWN"), "CHECKING");
  assert.equal(toGuestOrderPublicStatus("REJECTED"), "REJECTED");
});

import assert from "node:assert/strict";
import test from "node:test";

import { lookupGuestOrderPublicAction } from "../../src/commerce/guest-order-tracking-public-actions.ts";

test("guest tracking public action consumes client quota before parsing browser proof", async () => {
  const calls: string[] = [];
  const formData = new FormData();
  formData.set("orderCode", "");
  formData.set("phone", "0901234567");

  const result = await lookupGuestOrderPublicAction(
    {
      async consumeClient() {
        calls.push("client");
        return true;
      },
      async consumeOrderCode() {
        calls.push("code");
        return true;
      },
      async lookup() {
        calls.push("lookup");
        throw new Error("must not lookup malformed proof");
      },
    },
    formData,
  );

  assert.deepEqual(result, { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(calls, ["client"]);
});

test("guest tracking public action rate limits a valid code before database lookup", async () => {
  const calls: string[] = [];
  const formData = new FormData();
  formData.set("orderCode", " LA-123 ");
  formData.set("phone", " 0901234567 ");

  const result = await lookupGuestOrderPublicAction(
    {
      async consumeClient() {
        calls.push("client");
        return true;
      },
      async consumeOrderCode(orderCode) {
        calls.push(`code:${orderCode}`);
        return true;
      },
      async lookup(input) {
        calls.push(`lookup:${input.orderCode}:${input.phone}`);
        return {
          ok: true,
          order: {
            orderCode: input.orderCode,
            status: "CONFIRMED",
            createdAt: "2026-08-13T00:00:00.000Z",
            totalVnd: "530000",
          },
        };
      },
    },
    formData,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    "client",
    "code:LA-123",
    "lookup:LA-123:0901234567",
  ]);
});

test("guest tracking public action collapses rate-limit failures to UNAVAILABLE", async () => {
  const formData = new FormData();
  formData.set("orderCode", "LA-123");
  formData.set("phone", "0901234567");

  for (const failure of ["client-denied", "code-denied", "storage-error"] as const) {
    let lookupCalls = 0;
    const result = await lookupGuestOrderPublicAction(
      {
        async consumeClient() {
          if (failure === "storage-error") throw new Error("secret database detail");
          return failure !== "client-denied";
        },
        async consumeOrderCode() {
          return failure !== "code-denied";
        },
        async lookup() {
          lookupCalls += 1;
          return { ok: false as const, reason: "NOT_FOUND" as const };
        },
      },
      formData,
    );

    assert.deepEqual(result, { ok: false, reason: "UNAVAILABLE" });
    assert.equal(lookupCalls, 0);
    assert.equal(JSON.stringify(result).includes("secret database detail"), false);
  }
});

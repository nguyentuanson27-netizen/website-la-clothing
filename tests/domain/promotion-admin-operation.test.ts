import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  runPromotionAdminOperation,
  type PromotionOperationResult,
} from "../../src/operations/promotion-admin-operation.ts";
import {
  GATE_GOVERNED_OPERATIONS,
  PROMOTION_ACTIVATION_OPERATIONS,
  type PromotionActivationOperation,
  type PromotionObservabilitySignal,
} from "../../src/operations/promotion-observability.ts";

/**
 * These tests exist because of what the previous shape of this unit could not prove: deleting every
 * `emitPromotionSignal(...)` call from the production path left the observability unit tests green,
 * because those tests only exercised the pure shaping helpers. Each assertion here goes red if the
 * corresponding emission is removed from `runPromotionAdminOperation`.
 */

type Session = Readonly<{ user: { id: string } }>;

const SESSION: Session = { user: { id: "admin-1" } };

const GATE_ON = { LA_PROMOTION_ACTIVATION_ENABLED: "true" } as const;
const GATE_OFF = { LA_PROMOTION_ACTIVATION_ENABLED: "false" } as const;

type HarnessInput = Readonly<{
  operation?: PromotionActivationOperation;
  campaignId?: string;
  authorize?: () => Promise<Session>;
  run?: (session: Session) => Promise<PromotionOperationResult>;
  env?: Readonly<Record<string, string | undefined>>;
}>;

function harness(input: HarnessInput = {}) {
  const signals: PromotionObservabilitySignal[] = [];
  const sessionsSeen: Session[] = [];
  let commits = 0;

  const call = () =>
    runPromotionAdminOperation<Session>({
      operation: input.operation ?? "publish",
      campaignId: input.campaignId,
      authorize: input.authorize ?? (() => Promise.resolve(SESSION)),
      run: (session) => {
        sessionsSeen.push(session);
        return (input.run ?? (() => Promise.resolve({ ok: true as const })))(session);
      },
      onCommitted: () => {
        commits += 1;
      },
      emit: (signal) => signals.push(signal),
      env: input.env ?? GATE_OFF,
    });

  return {
    call,
    signals,
    sessionsSeen,
    commits: () => commits,
    rejections: () => signals.filter((signal) => signal.name === "promotion.activation_rejected"),
    gates: () => signals.filter((signal) => signal.name === "promotion.activation_gate"),
  };
}

test("an unauthorized caller is refused, and the refusal is what reaches the log", async () => {
  const context = harness({
    operation: "disable",
    campaignId: "campaign-7",
    authorize: () => Promise.reject(new AuthorizationError("FORBIDDEN")),
  });

  const outcome = await context.call();

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.failure.reason, "FORBIDDEN");
  assert.equal(outcome.ok === false && outcome.failure.wroteNothing, true);
  assert.equal(context.sessionsSeen.length, 0, "the mutation must not run");
  assert.deepEqual(context.signals, [
    {
      name: "promotion.activation_rejected",
      operation: "disable",
      campaignId: "campaign-7",
      reason: "FORBIDDEN",
    },
  ]);
});

test("an unauthenticated caller cannot make the process report its gate state", async () => {
  // The gate signal describes the deployment. Emitting it before authorization would let anyone
  // holding a URL both write log lines and learn whether activation is on.
  const context = harness({
    operation: "publish",
    env: GATE_ON,
    authorize: () => Promise.reject(new AuthorizationError("UNAUTHENTICATED")),
  });

  await context.call();

  assert.deepEqual(context.gates(), []);
});

test("a fault that is not an authorization failure is never rendered as a refusal", async () => {
  const context = harness({ authorize: () => Promise.reject(new Error("session store down")) });

  await assert.rejects(context.call, /session store down/);
  assert.deepEqual(context.signals, []);
});

test("a typed refusal reaches the log with its reason and bounded context", async () => {
  const context = harness({
    operation: "publish",
    campaignId: "campaign-7",
    run: () =>
      Promise.resolve({
        ok: false,
        failure: { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["other-1", "other-2"] },
      }),
  });

  const outcome = await context.call();

  assert.equal(outcome.ok === false && outcome.failure.reason, "OVERLAPPING_CAMPAIGN");
  assert.deepEqual(context.rejections(), [
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      campaignId: "campaign-7",
      reason: "OVERLAPPING_CAMPAIGN",
      affectedCount: 2,
      conflictingCampaignIds: ["other-1", "other-2"],
    },
  ]);
  assert.equal(context.commits(), 0, "a refusal must not invalidate the cache");
});

test("a duplicate-target driver error is emitted under the reason it translates to", async () => {
  const context = harness({
    operation: "create",
    run: () =>
      Promise.reject(
        Object.assign(new Error("unique"), {
          code: "P2002",
          meta: { modelName: "PromotionTarget" },
        }),
      ),
  });

  const outcome = await context.call();

  assert.equal(outcome.ok === false && outcome.failure.reason, "DUPLICATE_TARGET");
  assert.deepEqual(context.rejections(), [
    { name: "promotion.activation_rejected", operation: "create", reason: "DUPLICATE_TARGET" },
  ]);
});

test("a driver error with no admin translation is re-thrown rather than logged as a refusal", async () => {
  const context = harness({
    run: () => Promise.reject(Object.assign(new Error("deadlock"), { code: "P2034" })),
  });

  await assert.rejects(context.call, /deadlock/);
  assert.deepEqual(context.rejections(), [], "a genuine fault is not a promotion refusal");
});

test("a committed write invalidates the cache and reports no refusal", async () => {
  const context = harness({ operation: "copy", campaignId: "campaign-7" });

  const outcome = await context.call();

  assert.deepEqual(outcome, { ok: true });
  assert.equal(context.commits(), 1);
  assert.deepEqual(context.rejections(), []);
});

test("the mutation runs with the session authorization produced, not one the caller supplied", async () => {
  const context = harness({ run: () => Promise.resolve({ ok: true }) });

  await context.call();

  assert.deepEqual(context.sessionsSeen, [SESSION]);
});

test("gate state is reported for exactly the operations the gate decides", async () => {
  for (const operation of PROMOTION_ACTIVATION_OPERATIONS) {
    const governed = (GATE_GOVERNED_OPERATIONS as readonly string[]).includes(operation);

    for (const [env, enabled] of [
      [GATE_ON, true],
      [GATE_OFF, false],
    ] as const) {
      const context = harness({ operation, env });
      await context.call();

      assert.deepEqual(
        context.gates(),
        governed ? [{ name: "promotion.activation_gate", operation, enabled }] : [],
        `${operation} with the gate ${enabled ? "on" : "off"}`,
      );
    }
  }
});

test("the gate is reported before the outcome it may explain", async () => {
  const context = harness({
    operation: "publish",
    env: GATE_OFF,
    run: () => Promise.resolve({ ok: false, failure: { reason: "ACTIVATION_DISABLED" } }),
  });

  await context.call();

  assert.deepEqual(context.signals, [
    { name: "promotion.activation_gate", operation: "publish", enabled: false },
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: "ACTIVATION_DISABLED",
    },
  ]);
});

test("an absent or unbounded campaign identifier is omitted rather than logged", async () => {
  for (const campaignId of [undefined, "", "   ", "x".repeat(129)]) {
    const context = harness({
      operation: "disable",
      campaignId,
      run: () => Promise.resolve({ ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } }),
    });

    await context.call();

    assert.deepEqual(
      context.rejections(),
      [
        {
          name: "promotion.activation_rejected",
          operation: "disable",
          reason: "CAMPAIGN_NOT_FOUND",
        },
      ],
      `campaignId ${JSON.stringify(campaignId)} must not reach the signal`,
    );
  }
});

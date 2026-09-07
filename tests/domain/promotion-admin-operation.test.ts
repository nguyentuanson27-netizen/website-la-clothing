import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { MAX_PROMOTION_IDENTIFIER_LENGTH } from "../../src/commerce/promotion-activation.ts";
import {
  runPromotionAdminOperation,
  type PromotionOperationContext,
  type PromotionOperationResult,
} from "../../src/operations/promotion-admin-operation.ts";
import type {
  PromotionActivationOperation,
  PromotionObservabilitySignal,
} from "../../src/operations/promotion-observability.ts";

/**
 * These tests exist because of what the first shape of this unit could not prove: deleting every
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
  run?: (session: Session, context: PromotionOperationContext) => Promise<PromotionOperationResult>;
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
      run: (session, context) => {
        sessionsSeen.push(session);
        return (input.run ?? (() => Promise.resolve({ ok: true as const })))(session, context);
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

test("an unauthenticated request produces no promotion signal at all", async () => {
  // It never reached the promotion domain, so it has no promotion outcome to report — and anyone
  // holding the URL can send one, so emitting here would hand an anonymous caller a log-writing
  // primitive. The auth layer owns this event.
  const context = harness({
    operation: "publish",
    campaignId: "attacker-chosen-id",
    env: GATE_ON,
    authorize: () => Promise.reject(new AuthorizationError("UNAUTHENTICATED")),
  });

  const outcome = await context.call();

  assert.equal(outcome.ok === false && outcome.failure.reason, "FORBIDDEN");
  assert.deepEqual(context.signals, []);
  assert.equal(context.sessionsSeen.length, 0, "the mutation must not run");
});

test("a request-derived campaign identifier never reaches telemetry before authorization", async () => {
  // An authenticated non-admin is worth one categorical line: it is a real session, so the volume
  // is bounded and the attempt is worth seeing. What it must not carry is the identifier the caller
  // chose — nothing has established that it names a campaign, let alone one they may act on, so
  // logging it would let a caller mis-attribute a refusal to any campaign they can name.
  for (const campaignId of [
    "campaign-7",
    "attacker-chosen-id",
    "x".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH),
  ]) {
    const context = harness({
      operation: "disable",
      campaignId,
      authorize: () => Promise.reject(new AuthorizationError("FORBIDDEN")),
    });

    const outcome = await context.call();

    assert.equal(outcome.ok === false && outcome.failure.reason, "FORBIDDEN");
    assert.equal(outcome.ok === false && outcome.failure.wroteNothing, true);
    assert.equal(context.sessionsSeen.length, 0, "the mutation must not run");
    assert.deepEqual(
      context.signals,
      [{ name: "promotion.activation_rejected", operation: "disable", reason: "FORBIDDEN" }],
      `authorization failure must not carry ${JSON.stringify(campaignId)}`,
    );
    assert.equal(
      JSON.stringify(context.signals).includes(campaignId),
      false,
      "no request-derived value may appear anywhere in the serialized signal",
    );
  }
});

test("both authorization failures look identical to the browser", async () => {
  // The log distinguishes them; the response must not, or it discloses whether a session exists.
  const outcomes = [];
  for (const code of ["UNAUTHENTICATED", "FORBIDDEN"] as const) {
    const context = harness({ authorize: () => Promise.reject(new AuthorizationError(code)) });
    outcomes.push(await context.call());
  }

  assert.deepEqual(outcomes[0], outcomes[1]);
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

test("gate state is reported only by a branch that says it reached the gate", async () => {
  // The action label is too coarse to decide this: `edit` reaches the gated service function only
  // for a Scheduled campaign, so a Draft edit must produce no gate line at all.
  for (const operation of ["publish", "edit"] as const) {
    for (const [env, enabled] of [
      [GATE_ON, true],
      [GATE_OFF, false],
    ] as const) {
      const reporting = harness({
        operation,
        env,
        run: (_session, context) => {
          context.reportActivationGate();
          return Promise.resolve({ ok: true });
        },
      });
      await reporting.call();
      assert.deepEqual(
        reporting.gates(),
        [{ name: "promotion.activation_gate", operation, enabled }],
        `${operation} reaching the gate with it ${enabled ? "on" : "off"}`,
      );

      const silent = harness({ operation, env });
      await silent.call();
      assert.deepEqual(
        silent.gates(),
        [],
        `${operation} on a branch that never consults the gate must not report it`,
      );
    }
  }
});

test("an unauthorized caller cannot make the process report its gate state", async () => {
  // The report lives behind `authorize()` because the callback that can trigger it never runs
  // otherwise; this pins that rather than trusting the ordering to stay put.
  for (const code of ["UNAUTHENTICATED", "FORBIDDEN"] as const) {
    const context = harness({
      operation: "publish",
      env: GATE_ON,
      authorize: () => Promise.reject(new AuthorizationError(code)),
      run: (_session, gate) => {
        gate.reportActivationGate();
        return Promise.resolve({ ok: true });
      },
    });

    await context.call();

    assert.deepEqual(context.gates(), [], `${code} must not describe the deployment`);
  }
});

test("the gate is reported once, before the outcome it may explain", async () => {
  const context = harness({
    operation: "publish",
    env: GATE_OFF,
    run: (_session, gate) => {
      gate.reportActivationGate();
      gate.reportActivationGate();
      return Promise.resolve({ ok: false, failure: { reason: "ACTIVATION_DISABLED" } });
    },
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
  for (const campaignId of [undefined, "", "   ", "x".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH + 1)]) {
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

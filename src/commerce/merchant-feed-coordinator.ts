import {
  MERCHANT_FEED_CACHE_TTL_SECONDS,
  MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
} from "./merchant-feed-limits.ts";

export type MerchantFeedFailureClass =
  | "GENERATION_FAILURE"
  | "MARKET_UNRESOLVED"
  | "OFFER_OVERFLOW"
  | "BYTE_OVERFLOW"
  | "QUERY_BUDGET_FAILURE";

export type MerchantFeedGenerationResult =
  | Readonly<{
      ok: true;
      body: string;
      byteLength: number;
      offerCount: number;
      nextPricingTransitionAtMs: number | null;
    }>
  | Readonly<{ ok: false; failureClass: MerchantFeedFailureClass }>;

export type MerchantFeedEvent =
  | "success_cache_hit"
  | "cold_generation"
  | "generation_success"
  | "generation_failure"
  | "backoff_hit"
  | "offer_overflow"
  | "byte_overflow"
  | "query_budget_failure"
  | "market_unresolved"
  | "pricing_revision_changed"
  | "pricing_transition_crossed";

export type MerchantFeedCoordinatorResult =
  | Readonly<{
      ok: true;
      body: string;
      byteLength: number;
      offerCount: number;
      cache: "generated" | "hit";
    }>
  | Readonly<{
      ok: false;
      failureClass: MerchantFeedFailureClass;
      retryAfterSeconds: number;
      backoff: boolean;
    }>;

type SuccessCache = Readonly<{
  body: string;
  byteLength: number;
  offerCount: number;
  pricingRevision: bigint;
  expiresAtMs: number;
}>;

type FailureSentinel = Readonly<{
  failureClass: MerchantFeedFailureClass;
  retryAtMs: number;
}>;

type InFlightGeneration = Readonly<{
  pricingRevision: bigint;
  token: symbol;
  promise: Promise<MerchantFeedCoordinatorResult>;
}>;

function failureEvent(failureClass: MerchantFeedFailureClass): MerchantFeedEvent {
  switch (failureClass) {
    case "MARKET_UNRESOLVED":
      return "market_unresolved";
    case "OFFER_OVERFLOW":
      return "offer_overflow";
    case "BYTE_OVERFLOW":
      return "byte_overflow";
    case "QUERY_BUDGET_FAILURE":
      return "query_budget_failure";
    default:
      return "generation_failure";
  }
}

export function createMerchantFeedCoordinator({
  key,
  readPricingRevision,
  now = Date.now,
  observe = () => undefined,
}: Readonly<{
  key: string;
  readPricingRevision: () => Promise<bigint>;
  now?: () => number;
  observe?: (event: MerchantFeedEvent) => void;
}>) {
  if (typeof key !== "string" || key.length === 0 || key.length > 256) {
    throw new TypeError("Merchant feed coordinator requires one bounded trusted key");
  }
  if (typeof readPricingRevision !== "function") {
    throw new TypeError("Merchant feed coordinator requires the durable promotion pricing revision");
  }

  let successCache: SuccessCache | undefined;
  let failureSentinel: FailureSentinel | undefined;
  let inFlight: InFlightGeneration | undefined;

  function failureFromSentinel(sentinel: FailureSentinel, nowMs: number) {
    return Object.freeze({
      ok: false as const,
      failureClass: sentinel.failureClass,
      retryAfterSeconds: Math.max(1, Math.ceil((sentinel.retryAtMs - nowMs) / 1000)),
      backoff: true,
    });
  }

  function activeFailureSentinel(nowMs: number): MerchantFeedCoordinatorResult | null {
    if (failureSentinel === undefined || nowMs >= failureSentinel.retryAtMs) return null;
    observe("backoff_hit");
    return failureFromSentinel(failureSentinel, nowMs);
  }

  function installFailureSentinel(
    failureClass: MerchantFeedFailureClass,
    failedAtMs: number,
  ): MerchantFeedCoordinatorResult {
    failureSentinel = Object.freeze({
      failureClass,
      retryAtMs: failedAtMs + MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000,
    });
    observe(failureEvent(failureClass));
    return Object.freeze({
      ok: false as const,
      failureClass,
      retryAfterSeconds: MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
      backoff: false,
    });
  }

  function coherenceRetry(event: "pricing_revision_changed" | "pricing_transition_crossed") {
    observe(event);
    return Object.freeze({
      ok: false as const,
      failureClass: "GENERATION_FAILURE" as const,
      retryAfterSeconds: 1,
      backoff: false,
    });
  }

  async function readRevisionOrFail(): Promise<
    | Readonly<{ ok: true; revision: bigint }>
    | Readonly<{ ok: false; result: MerchantFeedCoordinatorResult }>
  > {
    try {
      const revision = await readPricingRevision();
      if (typeof revision !== "bigint" || revision < BigInt(0)) {
        throw new TypeError("invalid revision");
      }
      return Object.freeze({ ok: true as const, revision });
    } catch {
      return Object.freeze({
        ok: false as const,
        result: installFailureSentinel("GENERATION_FAILURE", now()),
      });
    }
  }

  function startGeneration(
    pricingRevision: bigint,
    generate: () => Promise<MerchantFeedGenerationResult>,
  ): Promise<MerchantFeedCoordinatorResult> {
    observe("cold_generation");

    const token = Symbol("merchant-feed-generation");
    const promise = (async () => {
      try {
        let generated: MerchantFeedGenerationResult;
        try {
          generated = await generate();
        } catch {
          generated = { ok: false, failureClass: "GENERATION_FAILURE" };
        }

        if (!generated.ok) {
          return installFailureSentinel(generated.failureClass, now());
        }

        const beforePublishRevision = await readRevisionOrFail();
        if (!beforePublishRevision.ok) return beforePublishRevision.result;
        if (beforePublishRevision.revision !== pricingRevision) {
          return coherenceRetry("pricing_revision_changed");
        }

        const publicationAtMs = now();
        if (
          generated.nextPricingTransitionAtMs !== null &&
          generated.nextPricingTransitionAtMs <= publicationAtMs
        ) {
          return coherenceRetry("pricing_transition_crossed");
        }

        const normalExpiryAtMs =
          publicationAtMs + MERCHANT_FEED_CACHE_TTL_SECONDS * 1000;
        const expiresAtMs =
          generated.nextPricingTransitionAtMs === null
            ? normalExpiryAtMs
            : Math.min(normalExpiryAtMs, generated.nextPricingTransitionAtMs);

        successCache = Object.freeze({
          body: generated.body,
          byteLength: generated.byteLength,
          offerCount: generated.offerCount,
          pricingRevision,
          expiresAtMs,
        });
        failureSentinel = undefined;
        observe("generation_success");
        return Object.freeze({
          ok: true as const,
          body: generated.body,
          byteLength: generated.byteLength,
          offerCount: generated.offerCount,
          cache: "generated" as const,
        });
      } finally {
        if (inFlight?.token === token) inFlight = undefined;
      }
    })();

    inFlight = Object.freeze({ pricingRevision, token, promise });
    return promise;
  }

  async function get({
    requestedKey = key,
    generate,
  }: Readonly<{
    requestedKey?: string;
    generate: () => Promise<MerchantFeedGenerationResult>;
  }>): Promise<MerchantFeedCoordinatorResult> {
    if (requestedKey !== key) {
      throw new TypeError("Merchant feed cache key is not part of the configured bounded domain");
    }

    const backedOff = activeFailureSentinel(now());
    if (backedOff !== null) return backedOff;

    const revisionRead = await readRevisionOrFail();
    if (!revisionRead.ok) return revisionRead.result;
    const currentRevision = revisionRead.revision;

    // A concurrent generation can fail while this request awaits the durable revision read, so the
    // negative sentinel is re-read here: a backoff installed during that window must still close the
    // expensive path instead of admitting a second heavy generation.
    const backedOffAfterRevisionRead = activeFailureSentinel(now());
    if (backedOffAfterRevisionRead !== null) return backedOffAfterRevisionRead;

    const decisionAtMs = now();

    if (successCache !== undefined) {
      if (
        decisionAtMs < successCache.expiresAtMs &&
        successCache.pricingRevision === currentRevision
      ) {
        observe("success_cache_hit");
        return Object.freeze({
          ok: true,
          body: successCache.body,
          byteLength: successCache.byteLength,
          offerCount: successCache.offerCount,
          cache: "hit",
        });
      }
      successCache = undefined;
    }

    while (inFlight !== undefined) {
      if (inFlight.pricingRevision === currentRevision) return inFlight.promise;
      await inFlight.promise;
      // A request that observed a different revision waits for the current generation to leave the
      // single-flight slot. If that generation failed for a real reason, its negative sentinel still
      // protects the expensive path; only revision/transition coherence retries omit it.
      const afterWaitBackoff = activeFailureSentinel(now());
      if (afterWaitBackoff !== null) return afterWaitBackoff;
    }

    return startGeneration(currentRevision, generate);
  }

  return Object.freeze({ get, key });
}

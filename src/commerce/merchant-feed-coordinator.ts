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
  | Readonly<{ ok: true; body: string; byteLength: number; offerCount: number }>
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
  | "market_unresolved";

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
  expiresAtMs: number;
}>;

type FailureSentinel = Readonly<{
  failureClass: MerchantFeedFailureClass;
  retryAtMs: number;
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
  now = Date.now,
  observe = () => undefined,
}: Readonly<{
  key: string;
  now?: () => number;
  observe?: (event: MerchantFeedEvent) => void;
}>) {
  if (typeof key !== "string" || key.length === 0 || key.length > 256) {
    throw new TypeError("Merchant feed coordinator requires one bounded trusted key");
  }

  let successCache: SuccessCache | undefined;
  let failureSentinel: FailureSentinel | undefined;
  let inFlight: Promise<MerchantFeedCoordinatorResult> | undefined;

  function failureFromSentinel(sentinel: FailureSentinel, nowMs: number) {
    return Object.freeze({
      ok: false as const,
      failureClass: sentinel.failureClass,
      retryAfterSeconds: Math.max(1, Math.ceil((sentinel.retryAtMs - nowMs) / 1000)),
      backoff: true,
    });
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

    const nowMs = now();
    if (successCache !== undefined && nowMs < successCache.expiresAtMs) {
      observe("success_cache_hit");
      return Object.freeze({
        ok: true,
        body: successCache.body,
        byteLength: successCache.byteLength,
        offerCount: successCache.offerCount,
        cache: "hit",
      });
    }

    if (failureSentinel !== undefined && nowMs < failureSentinel.retryAtMs) {
      observe("backoff_hit");
      return failureFromSentinel(failureSentinel, nowMs);
    }

    if (inFlight !== undefined) return inFlight;

    observe("cold_generation");
    inFlight = (async () => {
      try {
        let generated: MerchantFeedGenerationResult;
        try {
          generated = await generate();
        } catch {
          generated = { ok: false, failureClass: "GENERATION_FAILURE" };
        }

        const completedAtMs = now();
        if (!generated.ok) {
          failureSentinel = Object.freeze({
            failureClass: generated.failureClass,
            retryAtMs: completedAtMs + MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000,
          });
          observe(failureEvent(generated.failureClass));
          return Object.freeze({
            ok: false as const,
            failureClass: generated.failureClass,
            retryAfterSeconds: MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
            backoff: false,
          });
        }

        successCache = Object.freeze({
          body: generated.body,
          byteLength: generated.byteLength,
          offerCount: generated.offerCount,
          expiresAtMs: completedAtMs + MERCHANT_FEED_CACHE_TTL_SECONDS * 1000,
        });
        failureSentinel = undefined;
        observe("generation_success");
        return Object.freeze({ ...generated, cache: "generated" as const });
      } finally {
        inFlight = undefined;
      }
    })();

    return inFlight;
  }

  return Object.freeze({ get, key });
}

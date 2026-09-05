import { describe, expect, it } from "vitest";

import {
  createMerchantFeedCoordinator,
  type MerchantFeedGenerationResult,
} from "../../src/commerce/merchant-feed-coordinator.ts";
import {
  MERCHANT_FEED_CACHE_TTL_SECONDS,
  MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
} from "../../src/commerce/merchant-feed-limits.ts";

const KEY = "merchant-feed:v1:shop:920007";

function success(body = "<feed>ok</feed>"): MerchantFeedGenerationResult {
  return { ok: true, body, byteLength: new TextEncoder().encode(body).byteLength, offerCount: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Merchant feed coordinator", () => {
  it("caches only a complete success and performs no additional heavy work inside the TTL", async () => {
    let nowMs = 0;
    let generations = 0;
    const events: string[] = [];
    const coordinator = createMerchantFeedCoordinator({
      now: () => nowMs,
      observe: (event) => events.push(event),
    });
    const generate = async () => {
      generations += 1;
      return success();
    };

    const first = await coordinator.get({ key: KEY, generate });
    const second = await coordinator.get({ key: KEY, generate });
    const many = await Promise.all(Array.from({ length: 20 }, () => coordinator.get({ key: KEY, generate })));

    expect(first).toMatchObject({ ok: true, cache: "generated" });
    expect(second).toMatchObject({ ok: true, cache: "hit" });
    expect(many.every((result) => result.ok && result.cache === "hit")).toBe(true);
    expect(generations).toBe(1);
    expect(events).toContain("cold_generation");
    expect(events).toContain("generation_success");
    expect(events).toContain("success_cache_hit");

    nowMs = MERCHANT_FEED_CACHE_TTL_SECONDS * 1000 - 1;
    await coordinator.get({ key: KEY, generate });
    expect(generations).toBe(1);
  });

  it("collapses concurrent cold requests into one heavy generation", async () => {
    let generations = 0;
    const gate = deferred<MerchantFeedGenerationResult>();
    const coordinator = createMerchantFeedCoordinator({ now: () => 0 });
    const generate = () => {
      generations += 1;
      return gate.promise;
    };

    const requests = Array.from({ length: 25 }, () => coordinator.get({ key: KEY, generate }));
    await Promise.resolve();
    expect(generations).toBe(1);

    gate.resolve(success("<feed>same</feed>"));
    const results = await Promise.all(requests);
    expect(results.every((result) => result.ok && result.body === "<feed>same</feed>")).toBe(true);
    expect(generations).toBe(1);
  });

  it("rebuilds once under TTL-expiry concurrency", async () => {
    let nowMs = 0;
    let generations = 0;
    const coordinator = createMerchantFeedCoordinator({ now: () => nowMs });
    await coordinator.get({
      key: KEY,
      generate: async () => {
        generations += 1;
        return success("<feed>old</feed>");
      },
    });

    nowMs = MERCHANT_FEED_CACHE_TTL_SECONDS * 1000;
    const gate = deferred<MerchantFeedGenerationResult>();
    const generate = () => {
      generations += 1;
      return gate.promise;
    };
    const requests = Array.from({ length: 16 }, () => coordinator.get({ key: KEY, generate }));
    await Promise.resolve();
    expect(generations).toBe(2);

    gate.resolve(success("<feed>new</feed>"));
    const results = await Promise.all(requests);
    expect(results.every((result) => result.ok && result.body === "<feed>new</feed>")).toBe(true);
    expect(generations).toBe(2);
  });

  it("backs off failures cheaply and admits one retry when the sentinel expires", async () => {
    let nowMs = 0;
    let generations = 0;
    const events: string[] = [];
    const coordinator = createMerchantFeedCoordinator({
      now: () => nowMs,
      observe: (event) => events.push(event),
    });
    const fail = async (): Promise<MerchantFeedGenerationResult> => {
      generations += 1;
      return { ok: false, failureClass: "GENERATION_FAILURE" };
    };

    const first = await coordinator.get({ key: KEY, generate: fail });
    expect(first).toMatchObject({ ok: false, failureClass: "GENERATION_FAILURE" });
    expect(generations).toBe(1);

    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000 - 1;
    const duringBackoff = await Promise.all(
      Array.from({ length: 20 }, () => coordinator.get({ key: KEY, generate: fail })),
    );
    expect(duringBackoff.every((result) => !result.ok && result.backoff)).toBe(true);
    expect(generations).toBe(1);
    expect(events).toContain("backoff_hit");

    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000;
    const gate = deferred<MerchantFeedGenerationResult>();
    const retry = () => {
      generations += 1;
      return gate.promise;
    };
    const retryRequests = Array.from({ length: 12 }, () => coordinator.get({ key: KEY, generate: retry }));
    await Promise.resolve();
    expect(generations).toBe(2);
    gate.resolve(success("<feed>recovered</feed>"));
    const recovered = await Promise.all(retryRequests);
    expect(recovered.every((result) => result.ok && result.body === "<feed>recovered</feed>")).toBe(true);
    expect(generations).toBe(2);
  });

  it("does not let a hypothetical failing rebuild touch a still-valid success cache", async () => {
    let nowMs = 0;
    let generations = 0;
    const coordinator = createMerchantFeedCoordinator({ now: () => nowMs });
    await coordinator.get({
      key: KEY,
      generate: async () => {
        generations += 1;
        return success("<feed>good</feed>");
      },
    });

    nowMs = 1_000;
    const result = await coordinator.get({
      key: KEY,
      generate: async () => {
        generations += 1;
        return { ok: false, failureClass: "GENERATION_FAILURE" };
      },
    });

    expect(result).toMatchObject({ ok: true, cache: "hit", body: "<feed>good</feed>" });
    expect(generations).toBe(1);
  });
});

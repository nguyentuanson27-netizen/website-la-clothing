import { describe, expect, it } from "vitest";

import {
  createMerchantFeedCoordinator,
  type MerchantFeedGenerationResult,
} from "../../src/commerce/merchant-feed-coordinator.ts";
import {
  MERCHANT_FEED_CACHE_TTL_SECONDS,
  MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
} from "../../src/commerce/merchant-feed-limits.ts";

const KEY = "merchant-feed:rss-v1:shop:920007";

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

function coordinator(options: { now?: () => number; observe?: (event: string) => void } = {}) {
  return createMerchantFeedCoordinator({ key: KEY, ...options });
}

describe("Merchant feed coordinator", () => {
  it("caches a complete success and performs no additional heavy work inside the TTL", async () => {
    let nowMs = 0;
    let generations = 0;
    const events: string[] = [];
    const instance = coordinator({ now: () => nowMs, observe: (event) => events.push(event) });
    const generate = async () => {
      generations += 1;
      return success();
    };

    const first = await instance.get({ generate });
    const second = await instance.get({ generate });
    const many = await Promise.all(Array.from({ length: 20 }, () => instance.get({ generate })));

    expect(first).toMatchObject({ ok: true, cache: "generated" });
    expect(second).toMatchObject({ ok: true, cache: "hit" });
    expect(many.every((result) => result.ok && result.cache === "hit")).toBe(true);
    expect(generations).toBe(1);
    expect(events).toEqual(expect.arrayContaining(["cold_generation", "generation_success", "success_cache_hit"]));

    nowMs = MERCHANT_FEED_CACHE_TTL_SECONDS * 1000 - 1;
    await instance.get({ generate });
    expect(generations).toBe(1);
  });

  it("collapses concurrent cold requests and TTL-expiry rebuilds into one generation", async () => {
    let nowMs = 0;
    let generations = 0;
    const instance = coordinator({ now: () => nowMs });
    const coldGate = deferred<MerchantFeedGenerationResult>();
    const cold = () => {
      generations += 1;
      return coldGate.promise;
    };
    const coldRequests = Array.from({ length: 25 }, () => instance.get({ generate: cold }));
    await Promise.resolve();
    expect(generations).toBe(1);
    coldGate.resolve(success("<feed>old</feed>"));
    await Promise.all(coldRequests);

    nowMs = MERCHANT_FEED_CACHE_TTL_SECONDS * 1000;
    const rebuildGate = deferred<MerchantFeedGenerationResult>();
    const rebuild = () => {
      generations += 1;
      return rebuildGate.promise;
    };
    const rebuildRequests = Array.from({ length: 16 }, () => instance.get({ generate: rebuild }));
    await Promise.resolve();
    expect(generations).toBe(2);
    rebuildGate.resolve(success("<feed>new</feed>"));
    const rebuilt = await Promise.all(rebuildRequests);
    expect(rebuilt.every((result) => result.ok && result.body === "<feed>new</feed>")).toBe(true);
    expect(generations).toBe(2);
  });

  it("backs off failures cheaply and admits one single-flight retry at expiry", async () => {
    let nowMs = 0;
    let generations = 0;
    const instance = coordinator({ now: () => nowMs });
    const fail = async (): Promise<MerchantFeedGenerationResult> => {
      generations += 1;
      return { ok: false, failureClass: "GENERATION_FAILURE" };
    };

    await instance.get({ generate: fail });
    expect(generations).toBe(1);
    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000 - 1;
    const backedOff = await Promise.all(Array.from({ length: 20 }, () => instance.get({ generate: fail })));
    expect(backedOff.every((result) => !result.ok && result.backoff)).toBe(true);
    expect(generations).toBe(1);

    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000;
    const gate = deferred<MerchantFeedGenerationResult>();
    const retry = () => {
      generations += 1;
      return gate.promise;
    };
    const requests = Array.from({ length: 12 }, () => instance.get({ generate: retry }));
    await Promise.resolve();
    expect(generations).toBe(2);
    gate.resolve(success("<feed>recovered</feed>"));
    await Promise.all(requests);
    expect(generations).toBe(2);
  });

  it("keeps a valid success isolated and rejects unconfigured cache keys", async () => {
    let generations = 0;
    const instance = coordinator({ now: () => 1_000 });
    await instance.get({ generate: async () => { generations += 1; return success("<feed>good</feed>"); } });

    const hit = await instance.get({ generate: async () => { generations += 1; return { ok: false, failureClass: "GENERATION_FAILURE" }; } });
    expect(hit).toMatchObject({ ok: true, cache: "hit", body: "<feed>good</feed>" });
    expect(generations).toBe(1);

    await expect(instance.get({ requestedKey: `${KEY}:noise`, generate: async () => success() })).rejects.toThrow(/bounded domain/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMerchantFeedCoordinator,
  type MerchantFeedGenerationResult,
} from "../../src/commerce/merchant-feed-coordinator.ts";
import {
  MERCHANT_FEED_CACHE_TTL_SECONDS,
  MERCHANT_FEED_FAILURE_BACKOFF_SECONDS,
} from "../../src/commerce/merchant-feed-limits.ts";

const KEY = "merchant-feed:rss-v1:shop:920007";

function success(
  body = "<feed>ok</feed>",
  nextPricingTransitionAtMs: number | null = null,
) {
  return {
    ok: true as const,
    body,
    byteLength: new TextEncoder().encode(body).byteLength,
    offerCount: 1,
    nextPricingTransitionAtMs,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function coordinator(
  options: {
    now?: () => number;
    observe?: (event: string) => void;
    readPricingRevision?: () => Promise<bigint>;
  } = {},
) {
  return createMerchantFeedCoordinator({
    key: KEY,
    readPricingRevision: options.readPricingRevision ?? (async () => BigInt(1)),
    now: options.now,
    observe: options.observe,
  });
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

    assert.equal(first.ok, true);
    if (!first.ok) assert.fail("first result must be successful");
    assert.equal(first.cache, "generated");
    assert.equal(second.ok, true);
    if (!second.ok) assert.fail("second result must be successful");
    assert.equal(second.cache, "hit");
    assert.equal(many.every((result) => result.ok && result.cache === "hit"), true);
    assert.equal(generations, 1);
    assert.equal(events.includes("cold_generation"), true);
    assert.equal(events.includes("generation_success"), true);
    assert.equal(events.includes("success_cache_hit"), true);

    nowMs = MERCHANT_FEED_CACHE_TTL_SECONDS * 1000 - 1;
    await instance.get({ generate });
    assert.equal(generations, 1);
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
    assert.equal(generations, 1);
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
    assert.equal(generations, 2);
    rebuildGate.resolve(success("<feed>new</feed>"));
    const rebuilt = await Promise.all(rebuildRequests);
    assert.equal(rebuilt.every((result) => result.ok && result.body === "<feed>new</feed>"), true);
    assert.equal(generations, 2);
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
    assert.equal(generations, 1);
    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000 - 1;
    const backedOff = await Promise.all(Array.from({ length: 20 }, () => instance.get({ generate: fail })));
    assert.equal(backedOff.every((result) => !result.ok && result.backoff), true);
    assert.equal(generations, 1);

    nowMs = MERCHANT_FEED_FAILURE_BACKOFF_SECONDS * 1000;
    const gate = deferred<MerchantFeedGenerationResult>();
    const retry = () => {
      generations += 1;
      return gate.promise;
    };
    const requests = Array.from({ length: 12 }, () => instance.get({ generate: retry }));
    await Promise.resolve();
    assert.equal(generations, 2);
    gate.resolve(success("<feed>recovered</feed>"));
    await Promise.all(requests);
    assert.equal(generations, 2);
  });

  it("keeps a valid success isolated and rejects unconfigured cache keys", async () => {
    let generations = 0;
    const instance = coordinator({ now: () => 1_000 });
    await instance.get({
      generate: async () => {
        generations += 1;
        return success("<feed>good</feed>");
      },
    });

    const hit = await instance.get({
      generate: async () => {
        generations += 1;
        return { ok: false, failureClass: "GENERATION_FAILURE" };
      },
    });
    assert.equal(hit.ok, true);
    if (!hit.ok) assert.fail("cached result must stay successful");
    assert.equal(hit.cache, "hit");
    assert.equal(hit.body, "<feed>good</feed>");
    assert.equal(generations, 1);

    await assert.rejects(
      instance.get({ requestedKey: `${KEY}:noise`, generate: async () => success() }),
      /bounded domain/,
    );
  });

  it("invalidates a cached feed immediately after the durable pricing revision increments", async () => {
    let revision = BigInt(10);
    let generations = 0;
    const instance = coordinator({ readPricingRevision: async () => revision });
    const generate = async () => {
      generations += 1;
      return success(`<feed>revision-${revision}</feed>`);
    };

    const first = await instance.get({ generate });
    assert.equal(first.ok && first.body, "<feed>revision-10</feed>");

    revision = BigInt(11);
    const afterMutation = await instance.get({ generate });
    assert.equal(afterMutation.ok, true);
    if (!afterMutation.ok) assert.fail("new revision must rebuild successfully");
    assert.equal(afterMutation.cache, "generated");
    assert.equal(afterMutation.body, "<feed>revision-11</feed>");
    assert.equal(generations, 2);
  });

  it("does not publish an in-flight revision after a newer durable revision commits", async () => {
    let revision = BigInt(20);
    let generations = 0;
    const generationGate = deferred<MerchantFeedGenerationResult>();
    const instance = coordinator({ readPricingRevision: async () => revision });

    const oldRequest = instance.get({
      generate: () => {
        generations += 1;
        return generationGate.promise;
      },
    });
    await Promise.resolve();
    assert.equal(generations, 1);

    revision = BigInt(21);
    generationGate.resolve(success("<feed>stale-20</feed>"));
    const stale = await oldRequest;
    assert.equal(stale.ok, false, "revision N output must be discarded after N+1 is observed");

    const fresh = await instance.get({
      generate: async () => {
        generations += 1;
        return success("<feed>fresh-21</feed>");
      },
    });
    assert.equal(fresh.ok, true);
    if (!fresh.ok) assert.fail("new revision should remain rebuildable without stale publication");
    assert.equal(fresh.body, "<feed>fresh-21</feed>");
    assert.equal(generations, 2);
  });

  it("never joins a newer-revision request onto a stale in-flight generation", async () => {
    let revision = BigInt(40);
    let runningGenerations = 0;
    let maxRunningGenerations = 0;
    let generations = 0;
    const oldGate = deferred<MerchantFeedGenerationResult>();
    const freshGate = deferred<MerchantFeedGenerationResult>();
    const instance = coordinator({ readPricingRevision: async () => revision });

    const oldRequest = instance.get({
      generate: async () => {
        generations += 1;
        runningGenerations += 1;
        maxRunningGenerations = Math.max(maxRunningGenerations, runningGenerations);
        const result = await oldGate.promise;
        runningGenerations -= 1;
        return result;
      },
    });
    await Promise.resolve();
    assert.equal(generations, 1);

    revision = BigInt(41);
    const freshRequest = instance.get({
      generate: async () => {
        generations += 1;
        runningGenerations += 1;
        maxRunningGenerations = Math.max(maxRunningGenerations, runningGenerations);
        const result = await freshGate.promise;
        runningGenerations -= 1;
        return result;
      },
    });
    await Promise.resolve();
    assert.equal(generations, 1, "the newer revision must wait rather than overlap heavy work");

    oldGate.resolve(success("<feed>stale-40</feed>"));
    const oldResult = await oldRequest;
    assert.equal(oldResult.ok, false);
    await Promise.resolve();
    assert.equal(generations, 2, "the newer revision starts only after the stale flight leaves");

    freshGate.resolve(success("<feed>fresh-41</feed>"));
    const freshResult = await freshRequest;
    assert.equal(freshResult.ok, true);
    if (!freshResult.ok) assert.fail("newer revision must complete with its own generation");
    assert.equal(freshResult.body, "<feed>fresh-41</feed>");
    assert.equal(maxRunningGenerations, 1);
  });

  it("preserves a real failure backoff after a newer-revision request waits for a stale flight", async () => {
    let revision = BigInt(50);
    let generations = 0;
    const oldGate = deferred<MerchantFeedGenerationResult>();
    const instance = coordinator({ readPricingRevision: async () => revision });

    const oldRequest = instance.get({
      generate: () => {
        generations += 1;
        return oldGate.promise;
      },
    });
    await Promise.resolve();
    revision = BigInt(51);

    const newerRequest = instance.get({
      generate: async () => {
        generations += 1;
        return success("<feed>must-not-run</feed>");
      },
    });
    oldGate.resolve({ ok: false, failureClass: "GENERATION_FAILURE" });

    const [oldResult, newerResult] = await Promise.all([oldRequest, newerRequest]);
    assert.equal(oldResult.ok, false);
    assert.equal(newerResult.ok, false);
    if (newerResult.ok) assert.fail("the newer request must observe the old flight's backoff");
    assert.equal(newerResult.backoff, true);
    assert.equal(generations, 1);
  });

  it("expires cached pricing exactly at the nearest campaign start boundary", async () => {
    let nowMs = 1_000;
    let generations = 0;
    const startAtMs = 2_000;
    const instance = coordinator({ now: () => nowMs });
    const generate = async () => {
      generations += 1;
      return success(`<feed>generation-${generations}</feed>`, startAtMs);
    };

    await instance.get({ generate });
    nowMs = startAtMs - 1;
    const before = await instance.get({ generate });
    assert.equal(before.ok && before.cache, "hit");
    assert.equal(generations, 1);

    nowMs = startAtMs;
    const atBoundary = await instance.get({ generate });
    assert.equal(atBoundary.ok && atBoundary.cache, "generated");
    assert.equal(generations, 2);
  });

  it("expires cached pricing exactly at the nearest campaign end boundary", async () => {
    let nowMs = 10_000;
    let generations = 0;
    const endAtMs = 12_500;
    const instance = coordinator({ now: () => nowMs });
    const generate = async () => {
      generations += 1;
      return success(`<feed>generation-${generations}</feed>`, endAtMs);
    };

    await instance.get({ generate });
    nowMs = endAtMs - 1;
    const before = await instance.get({ generate });
    assert.equal(before.ok && before.cache, "hit");
    assert.equal(generations, 1);

    nowMs = endAtMs;
    const atBoundary = await instance.get({ generate });
    assert.equal(atBoundary.ok && atBoundary.cache, "generated");
    assert.equal(generations, 2);
  });

  it("fails closed instead of serving a cached success when the durable revision read fails", async () => {
    let failRevisionRead = false;
    let generations = 0;
    const instance = coordinator({
      readPricingRevision: async () => {
        if (failRevisionRead) throw new Error("database unavailable");
        return BigInt(30);
      },
    });

    await instance.get({
      generate: async () => {
        generations += 1;
        return success("<feed>cached</feed>");
      },
    });

    failRevisionRead = true;
    const failed = await instance.get({
      generate: async () => {
        generations += 1;
        return success("<feed>must-not-run</feed>");
      },
    });

    assert.equal(failed.ok, false);
    assert.equal(generations, 1, "a failed revision validation must not start heavy generation");
  });
});

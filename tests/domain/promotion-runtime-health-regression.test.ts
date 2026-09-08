import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { evaluateCampaignRuntimeHealth } from "../../src/commerce/promotion-runtime-health.ts";

function createCampaign(id: string, productId: string) {
  return {
    id,
    kind: "PROMOTION" as const,
    name: "Runtime Health Regression",
    discountType: "PERCENTAGE" as const,
    percentageValue: 10,
    fixedPriceVnd: null,
    startsAt: new Date("2026-03-01T00:00:00Z"),
    endsAt: new Date("2026-03-31T00:00:00Z"),
    targets: [{ productId, variantId: null }],
  };
}

describe("promotion runtime-health regression guards", () => {
  it("processes candidate authority per bounded coverage page instead of materializing the whole campaign", async () => {
    const totalVariants = 1_200;
    const productId = "prod-streamed";
    const variants = Array.from({ length: totalVariants }, (_, index) => ({
      id: `var-stream-${index.toString().padStart(4, "0")}`,
      productId,
      pancakeRetailPrice: 100_000,
    }));
    const events: string[] = [];

    const mockClient = {
      promotionCampaign: {
        findUnique: async () => createCampaign("camp-streamed", productId),
      },
      variantMirror: {
        findMany: async (args: {
          take?: number;
          cursor?: { id: string };
          skip?: number;
          where?: { id?: { in?: string[] } };
          select?: { id?: boolean; productId?: boolean; pancakeRetailPrice?: boolean };
        }) => {
          if (args.select?.pancakeRetailPrice) {
            events.push(`coverage:${args.cursor?.id ?? "start"}`);
            const take = args.take ?? 500;
            let startIndex = 0;
            if (args.cursor) {
              const index = variants.findIndex((variant) => variant.id === args.cursor?.id);
              startIndex = index >= 0 ? index + (args.skip ?? 0) : 0;
            }
            return variants.slice(startIndex, startIndex + take);
          }

          const requestedIds = args.where?.id?.in ?? [];
          events.push(`candidate-variants:${requestedIds.length}`);
          const requested = new Set(requestedIds);
          return variants
            .filter((variant) => requested.has(variant.id))
            .map(({ id, productId: ownerProductId }) => ({ id, productId: ownerProductId }));
        },
      },
      promotionTarget: {
        findMany: async () => {
          events.push("candidate-targets");
          return [];
        },
      },
    };

    const health = await evaluateCampaignRuntimeHealth({
      campaignId: "camp-streamed",
      client: mockClient as unknown as Parameters<typeof evaluateCampaignRuntimeHealth>[0]["client"],
      now: new Date("2026-03-15T00:00:00Z"),
      writer: () => {},
    });

    assert.ok(health);
    assert.equal(health.status, "HEALTHY");
    assert.equal(health.coveredVariants, totalVariants);

    const coverageReads = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.startsWith("coverage:"));
    assert.ok(coverageReads.length >= 3, "fixture must span multiple coverage pages");

    const firstCandidateTargetRead = events.indexOf("candidate-targets");
    assert.ok(firstCandidateTargetRead >= 0, "candidate authority must be consulted");
    assert.ok(
      firstCandidateTargetRead < coverageReads[1]!.index,
      "candidate evaluation for page 1 must finish before page 2 is fetched",
    );

    const candidateVariantBatchSizes = events
      .filter((event) => event.startsWith("candidate-variants:"))
      .map((event) => Number(event.split(":")[1]));
    assert.ok(candidateVariantBatchSizes.length > 0);
    assert.ok(
      candidateVariantBatchSizes.every((size) => size <= 200),
      "canonical candidate reader must retain its per-query safety bound",
    );
  });

  it("does not return or emit HEALTHY when candidate authority fails", async () => {
    const productId = "prod-candidate-failure";
    const variant = {
      id: "var-candidate-failure",
      productId,
      pancakeRetailPrice: 100_000,
    };
    const emittedLines: string[] = [];

    const mockClient = {
      promotionCampaign: {
        findUnique: async () => createCampaign("camp-candidate-failure", productId),
      },
      variantMirror: {
        findMany: async (args: {
          select?: { id?: boolean; productId?: boolean; pancakeRetailPrice?: boolean };
        }) => {
          if (args.select?.pancakeRetailPrice) return [variant];
          return [{ id: variant.id, productId: variant.productId }];
        },
      },
      promotionTarget: {
        findMany: async () => {
          throw new Error("candidate repository unavailable");
        },
      },
    };

    const health = await evaluateCampaignRuntimeHealth({
      campaignId: "camp-candidate-failure",
      client: mockClient as unknown as Parameters<typeof evaluateCampaignRuntimeHealth>[0]["client"],
      now: new Date("2026-03-15T00:00:00Z"),
      writer: (line) => emittedLines.push(line),
    });

    assert.equal(health, null, "unknown candidate truth must not masquerade as HEALTHY");
    assert.equal(emittedLines.length, 0, "no runtime-health signal is emitted for incomplete source truth");
  });

  it("documents an executable emergency rollback command and accepted admin session shape", () => {
    const runbook = readFileSync(
      new URL("../../docs/operations/promotion-rollback-runbook.md", import.meta.url),
      "utf8",
    );

    assert.match(runbook, /node --experimental-strip-types --input-type=module -e/);
    assert.match(runbook, /session:\s*\{\s*id:\s*"emergency-ops"\s*\}/);
  });
});

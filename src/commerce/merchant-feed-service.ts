import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";

import {
  createMerchantFeedCoordinator,
  type MerchantFeedCoordinatorResult,
  type MerchantFeedEvent,
  type MerchantFeedFailureClass,
} from "./merchant-feed-coordinator.ts";
import {
  MerchantFeedByteOverflowError,
  MerchantFeedOfferOverflowError,
  serializeMerchantFeed,
} from "./merchant-feed-serializer.ts";
import { createMerchantOfferRepository, MerchantOfferReadError } from "./merchant-offer-repository.ts";
import { readStorefrontOrigin } from "./storefront-origin.ts";

const MERCHANT_FEED_SCHEMA_VERSION = "rss-v1";

function observeMerchantFeed(event: MerchantFeedEvent): void {
  // Bounded event names only: no request data, product data, exceptions, credentials or PII.
  console.info(`[merchant-feed] ${event}`);
}

let runtimeCoordinator:
  | Readonly<{
      key: string;
      coordinator: ReturnType<typeof createMerchantFeedCoordinator>;
    }>
  | undefined;

function coordinatorFor(key: string) {
  if (runtimeCoordinator === undefined) {
    runtimeCoordinator = Object.freeze({
      key,
      coordinator: createMerchantFeedCoordinator({ key, observe: observeMerchantFeed }),
    });
  } else if (runtimeCoordinator.key !== key) {
    // A process should have exactly one trusted shop/schema domain. Treat env drift as a config
    // failure rather than silently allocating another public heavy-work domain.
    throw new Error("Merchant feed trusted cache key changed during the process lifetime");
  }
  return runtimeCoordinator.coordinator;
}

function classifyGenerationFailure(error: unknown): MerchantFeedFailureClass {
  if (error instanceof MerchantFeedOfferOverflowError) return "OFFER_OVERFLOW";
  if (error instanceof MerchantFeedByteOverflowError) return "BYTE_OVERFLOW";
  if (
    error instanceof MerchantOfferReadError &&
    error.message.includes("query envelope")
  ) {
    return "QUERY_BUDGET_FAILURE";
  }
  return "GENERATION_FAILURE";
}

export async function getMerchantFeed(): Promise<MerchantFeedCoordinatorResult> {
  let shopId: number;
  let origin: string;
  try {
    shopId = readPancakeShopId();
    origin = readStorefrontOrigin();
  } catch {
    return Object.freeze({
      ok: false,
      failureClass: "GENERATION_FAILURE" as const,
      retryAfterSeconds: 60,
      backoff: false,
    });
  }

  const key = `merchant-feed:${MERCHANT_FEED_SCHEMA_VERSION}:shop:${shopId}`;
  let coordinator: ReturnType<typeof createMerchantFeedCoordinator>;
  try {
    coordinator = coordinatorFor(key);
  } catch {
    return Object.freeze({
      ok: false,
      failureClass: "GENERATION_FAILURE" as const,
      retryAfterSeconds: 60,
      backoff: false,
    });
  }

  return coordinator.get({
    generate: async () => {
      try {
        const mapped = await createMerchantOfferRepository(prisma).readMerchantOffers({
          shopId,
          origin,
        });

        if (mapped.market.status !== "APPROVED" || mapped.activationBlockedReasons.length > 0) {
          return Object.freeze({ ok: false as const, failureClass: "MARKET_UNRESOLVED" as const });
        }

        const serialized = serializeMerchantFeed({
          offers: mapped.offers,
          market: mapped.market.policy,
          origin,
        });
        return Object.freeze({ ok: true as const, ...serialized });
      } catch (error) {
        return Object.freeze({ ok: false as const, failureClass: classifyGenerationFailure(error) });
      }
    },
  });
}

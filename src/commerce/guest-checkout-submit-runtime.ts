import { randomUUID } from "node:crypto";

import { prisma } from "../db/prisma.ts";
import { readPancakeConfig, type PancakeConfig } from "../integrations/pancake/config.ts";
import { recoverStrandedGuestCheckoutForCart } from "./guest-checkout-recovery.ts";
import { createGuestCheckoutSnapshotService } from "./guest-checkout-snapshot.ts";
import {
  createGuestCheckoutSubmitService,
  type GuestCheckoutSubmitDependencies,
} from "./guest-checkout-submit.ts";
import { createPancakeOrderSubmissionRuntime } from "./pancake-order-submit-runtime.ts";

type GuestCheckoutSubmitRuntimeDependencies = Readonly<{
  readConfig: () => PancakeConfig;
  createSnapshot: () => GuestCheckoutSubmitDependencies["snapshot"];
  createOrderSubmission: (
    config: PancakeConfig,
  ) => GuestCheckoutSubmitDependencies["orderSubmission"];
  recoverStranded: (input: { cartId: string; now: Date }) => Promise<void>;
  generatePublicCode: () => string;
  clock: () => Date;
}>;

type GuestCheckoutSubmitRuntimeOptions = Partial<GuestCheckoutSubmitRuntimeDependencies>;

export function createGuestCheckoutSubmitRuntime(
  options: GuestCheckoutSubmitRuntimeOptions = {},
) {
  const readConfig = options.readConfig ?? readPancakeConfig;
  const createSnapshot =
    options.createSnapshot ?? (() => createGuestCheckoutSnapshotService(prisma));
  const createOrderSubmission =
    options.createOrderSubmission ?? createPancakeOrderSubmissionRuntime;
  const recoverStranded =
    options.recoverStranded ??
    (({ cartId, now }) => recoverStrandedGuestCheckoutForCart(prisma, cartId, now));
  const generatePublicCode = options.generatePublicCode ?? (() => `LA-${randomUUID()}`);
  const clock = options.clock ?? (() => new Date());

  async function submit({
    cartId,
    checkoutInput,
  }: {
    cartId: string;
    checkoutInput: unknown;
  }) {
    const now = clock();
    await recoverStranded({ cartId, now });

    const config = readConfig();
    const service = createGuestCheckoutSubmitService({
      snapshot: createSnapshot(),
      orderSubmission: createOrderSubmission(config),
      generatePublicCode,
    });

    return service.submit({
      cartId,
      shopId: config.shopId,
      checkoutInput,
      now,
    });
  }

  return { submit };
}

export async function submitGuestCheckoutByCart(input: {
  cartId: string;
  checkoutInput: unknown;
}) {
  return createGuestCheckoutSubmitRuntime().submit(input);
}

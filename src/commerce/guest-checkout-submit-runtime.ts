import { randomUUID } from "node:crypto";

import { prisma } from "../db/prisma.ts";
import { PancakeClient } from "../integrations/pancake/client.ts";
import { readPancakeConfig, type PancakeConfig } from "../integrations/pancake/config.ts";
import {
  loadCheckoutCommunes,
  loadCheckoutDistricts,
  loadCheckoutProvinces,
} from "./checkout-geo.ts";
import { validateCheckoutGeoSelection } from "./checkout-geo-validation.ts";
import { recoverStrandedGuestCheckoutForCart } from "./guest-checkout-recovery.ts";
import {
  createGuestCheckoutSnapshotService,
  requiresFreshGuestCheckoutSnapshot,
} from "./guest-checkout-snapshot.ts";
import {
  createGuestCheckoutSubmitService,
  type GuestCheckoutSubmitDependencies,
} from "./guest-checkout-submit.ts";
import { createPancakeOrderSubmissionRuntime } from "./pancake-order-submit-runtime.ts";

type SnapshotAuthority = Readonly<{
  checkoutInputValidated: boolean;
}>;

type GuestCheckoutSubmitRuntimeDependencies = Readonly<{
  readConfig: () => PancakeConfig;
  requiresFreshSnapshot: (cartId: string) => Promise<boolean>;
  validateGeo: (
    config: PancakeConfig,
    checkoutInput: unknown,
  ) => ReturnType<typeof validateCheckoutGeoSelection>;
  createSnapshot: (
    authority: SnapshotAuthority,
  ) => GuestCheckoutSubmitDependencies["snapshot"];
  createOrderSubmission: (
    config: PancakeConfig,
  ) => GuestCheckoutSubmitDependencies["orderSubmission"];
  recoverStranded: (input: { cartId: string; now: Date }) => Promise<void>;
  generatePublicCode: () => string;
  clock: () => Date;
}>;

type GuestCheckoutSubmitRuntimeOptions = Partial<GuestCheckoutSubmitRuntimeDependencies>;

async function validateCheckoutGeoWithPancake(
  config: PancakeConfig,
  checkoutInput: unknown,
) {
  const client = new PancakeClient({ apiKey: config.apiKey });
  return validateCheckoutGeoSelection(
    {
      loadProvinces: () => loadCheckoutProvinces(client),
      loadDistricts: (provinceId) => loadCheckoutDistricts(client, provinceId),
      loadCommunes: (provinceId, districtId) =>
        loadCheckoutCommunes(client, provinceId, districtId),
    },
    checkoutInput,
  );
}

export function createGuestCheckoutSubmitRuntime(
  options: GuestCheckoutSubmitRuntimeOptions = {},
) {
  const readConfig = options.readConfig ?? readPancakeConfig;
  const requiresFreshSnapshot =
    options.requiresFreshSnapshot ??
    ((cartId) => requiresFreshGuestCheckoutSnapshot(prisma, cartId));
  const validateGeo = options.validateGeo ?? validateCheckoutGeoWithPancake;
  const createSnapshot =
    options.createSnapshot ??
    ((authority) => createGuestCheckoutSnapshotService(prisma, authority));
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
    const needsFreshSnapshot = await requiresFreshSnapshot(cartId);

    let authoritativeCheckoutInput = checkoutInput;
    let checkoutInputValidated = false;
    if (needsFreshSnapshot) {
      const geoValidation = await validateGeo(config, checkoutInput);
      if (!geoValidation.ok) {
        return {
          ok: false as const,
          status: "RETRYABLE" as const,
          reason: "INVALID_INPUT" as const,
        };
      }
      authoritativeCheckoutInput = geoValidation.checkoutInput;
      checkoutInputValidated = true;
    }

    const service = createGuestCheckoutSubmitService({
      snapshot: createSnapshot({ checkoutInputValidated }),
      orderSubmission: createOrderSubmission(config),
      generatePublicCode,
    });

    return service.submit({
      cartId,
      shopId: config.shopId,
      checkoutInput: authoritativeCheckoutInput,
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

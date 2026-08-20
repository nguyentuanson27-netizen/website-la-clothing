import { readAuthServerConfig } from "../auth/config.ts";
import { readGuestShippingPolicy } from "../commerce/guest-shipping-policy.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import { validateSearchExposureForRelease } from "../seo/search-exposure.ts";

type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;

export type ReleaseReadinessSummary = Readonly<{
  databaseConfigured: true;
  storefrontOriginConfigured: true;
  searchIndexingEnabled: boolean;
  authConfigured: true;
  trustedIpHeaderConfigured: boolean;
  pancakeConfigured: true;
  pancakeShopId: number;
  shippingPolicy: Readonly<{
    feeVnd: number;
    freeShippingSubtotalVnd: number;
    freeShippingMinQuantity: number;
  }>;
}>;

function validateDatabaseUrl(value: string | undefined): void {
  if (!value) {
    throw new Error("DATABASE_URL must be configured on the server");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
}

export function validateReleaseEnvironment(
  env: ReleaseEnvironment = process.env,
): ReleaseReadinessSummary {
  validateDatabaseUrl(env.DATABASE_URL);
  const searchExposure = validateSearchExposureForRelease(env);
  const auth = readAuthServerConfig(env);
  const pancake = readPancakeConfig(env);
  const shippingPolicy = readGuestShippingPolicy(env);

  return {
    databaseConfigured: true,
    storefrontOriginConfigured: true,
    searchIndexingEnabled: searchExposure.indexingEnabled,
    authConfigured: true,
    trustedIpHeaderConfigured: auth.ipAddressHeader !== undefined,
    pancakeConfigured: true,
    pancakeShopId: pancake.shopId,
    shippingPolicy,
  };
}

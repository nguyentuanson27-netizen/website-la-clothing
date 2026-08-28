import { createHmac, timingSafeEqual } from "node:crypto";

const PROOF_VERSION = "v1";
const PROOF_PURPOSE = "la-clothing/admin-catalog-confirmation";
const SIGNING_DOMAIN = `${PROOF_PURPOSE}/${PROOF_VERSION}`;
const SIGNATURE_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export const ADMIN_CATALOG_CONFIRMATION_LIMITS = {
  ttlMs: 5 * 60_000,
  idLength: 128,
  productCount: 100,
  secretLength: 32,
  proofLength: 64_000,
} as const;

type CatalogConfirmationOperation = "enable";

type CatalogConfirmationStateInput = {
  actorId: string;
  operation: CatalogConfirmationOperation;
  targetProductIds: readonly string[];
  zeroActiveProductIds: readonly string[];
  compositeChildProductIds: readonly string[];
};

type IssueCatalogConfirmationProofInput = CatalogConfirmationStateInput & {
  secret: string;
  nowMs: number;
};

type VerifyCatalogConfirmationProofInput = CatalogConfirmationStateInput & {
  secret: string;
  nowMs: number;
  proof: string;
};

type CatalogConfirmationPayload = {
  purpose: typeof PROOF_PURPOSE;
  version: typeof PROOF_VERSION;
  actorId: string;
  operation: CatalogConfirmationOperation;
  targetProductIds: string[];
  zeroActiveProductIds: string[];
  compositeChildProductIds: string[];
  issuedAtMs: number;
  expiresAtMs: number;
};

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= ADMIN_CATALOG_CONFIRMATION_LIMITS.idLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function canonicalizeUniqueIds(
  values: readonly string[],
  options: { allowEmpty: boolean; targetIds?: ReadonlySet<string> },
): string[] {
  if (!Array.isArray(values)) {
    throw new RangeError("Catalog confirmation IDs are invalid");
  }
  if (
    (!options.allowEmpty && values.length === 0) ||
    values.length > ADMIN_CATALOG_CONFIRMATION_LIMITS.productCount
  ) {
    throw new RangeError("Catalog confirmation IDs are invalid");
  }

  const seen = new Set<string>();
  const canonical: string[] = [];
  for (const value of values) {
    if (!isBoundedId(value) || seen.has(value)) {
      throw new RangeError("Catalog confirmation IDs are invalid");
    }
    if (options.targetIds && !options.targetIds.has(value)) {
      throw new RangeError("Catalog confirmation warning IDs are invalid");
    }
    seen.add(value);
    canonical.push(value);
  }

  canonical.sort();
  return canonical;
}

function parseSecret(secret: unknown): string {
  if (
    typeof secret !== "string" ||
    secret.length < ADMIN_CATALOG_CONFIRMATION_LIMITS.secretLength ||
    secret.length > 4_096
  ) {
    throw new RangeError("Catalog confirmation secret is invalid");
  }
  return secret;
}

function parseNowMs(nowMs: unknown): number {
  if (!Number.isSafeInteger(nowMs) || (nowMs as number) < 0) {
    throw new RangeError("Catalog confirmation time is invalid");
  }
  return nowMs as number;
}

function canonicalizeState(input: CatalogConfirmationStateInput) {
  if (!isBoundedId(input.actorId) || input.operation !== "enable") {
    throw new RangeError("Catalog confirmation state is invalid");
  }

  const targetProductIds = canonicalizeUniqueIds(input.targetProductIds, {
    allowEmpty: false,
  });
  const targetIds = new Set(targetProductIds);

  return {
    actorId: input.actorId,
    operation: input.operation,
    targetProductIds,
    zeroActiveProductIds: canonicalizeUniqueIds(input.zeroActiveProductIds, {
      allowEmpty: true,
      targetIds,
    }),
    compositeChildProductIds: canonicalizeUniqueIds(input.compositeChildProductIds, {
      allowEmpty: true,
      targetIds,
    }),
  };
}

function signEncodedPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(SIGNING_DOMAIN)
    .update(".")
    .update(encodedPayload)
    .digest();
}

function encodePayload(payload: CatalogConfirmationPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function payloadMatchesState(
  payload: CatalogConfirmationPayload,
  state: ReturnType<typeof canonicalizeState>,
): boolean {
  return (
    payload.actorId === state.actorId &&
    payload.operation === state.operation &&
    arraysEqual(payload.targetProductIds, state.targetProductIds) &&
    arraysEqual(payload.zeroActiveProductIds, state.zeroActiveProductIds) &&
    arraysEqual(payload.compositeChildProductIds, state.compositeChildProductIds)
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseSignedPayload(encodedPayload: string): CatalogConfirmationPayload | null {
  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const candidate: unknown = JSON.parse(decoded);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

    const payload = candidate as Partial<CatalogConfirmationPayload>;
    if (
      payload.purpose !== PROOF_PURPOSE ||
      payload.version !== PROOF_VERSION ||
      payload.operation !== "enable" ||
      !isBoundedId(payload.actorId) ||
      !Number.isSafeInteger(payload.issuedAtMs) ||
      !Number.isSafeInteger(payload.expiresAtMs) ||
      !Array.isArray(payload.targetProductIds) ||
      !Array.isArray(payload.zeroActiveProductIds) ||
      !Array.isArray(payload.compositeChildProductIds)
    ) {
      return null;
    }

    const state = canonicalizeState({
      actorId: payload.actorId,
      operation: payload.operation,
      targetProductIds: payload.targetProductIds,
      zeroActiveProductIds: payload.zeroActiveProductIds,
      compositeChildProductIds: payload.compositeChildProductIds,
    });

    if (
      !arraysEqual(payload.targetProductIds, state.targetProductIds) ||
      !arraysEqual(payload.zeroActiveProductIds, state.zeroActiveProductIds) ||
      !arraysEqual(payload.compositeChildProductIds, state.compositeChildProductIds)
    ) {
      return null;
    }

    return payload as CatalogConfirmationPayload;
  } catch {
    return null;
  }
}

export function issueAdminCatalogConfirmationProof(
  input: IssueCatalogConfirmationProofInput,
): { proof: string; expiresAtMs: number } {
  const secret = parseSecret(input.secret);
  const nowMs = parseNowMs(input.nowMs);
  const state = canonicalizeState(input);
  const expiresAtMs = nowMs + ADMIN_CATALOG_CONFIRMATION_LIMITS.ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError("Catalog confirmation expiry is invalid");
  }

  const payload: CatalogConfirmationPayload = {
    purpose: PROOF_PURPOSE,
    version: PROOF_VERSION,
    ...state,
    issuedAtMs: nowMs,
    expiresAtMs,
  };
  const encodedPayload = encodePayload(payload);
  const signature = signEncodedPayload(encodedPayload, secret).toString("base64url");
  const proof = `${PROOF_VERSION}.${encodedPayload}.${signature}`;

  if (proof.length > ADMIN_CATALOG_CONFIRMATION_LIMITS.proofLength) {
    throw new RangeError("Catalog confirmation proof is invalid");
  }

  return { proof, expiresAtMs };
}

export function verifyAdminCatalogConfirmationProof(
  input: VerifyCatalogConfirmationProofInput,
): boolean {
  try {
    const secret = parseSecret(input.secret);
    const nowMs = parseNowMs(input.nowMs);
    const expectedState = canonicalizeState(input);

    if (
      typeof input.proof !== "string" ||
      input.proof.length < 1 ||
      input.proof.length > ADMIN_CATALOG_CONFIRMATION_LIMITS.proofLength
    ) {
      return false;
    }

    const parts = input.proof.split(".");
    if (
      parts.length !== 3 ||
      parts[0] !== PROOF_VERSION ||
      !parts[1] ||
      !parts[2] ||
      !BASE64URL_PATTERN.test(parts[1]) ||
      !BASE64URL_PATTERN.test(parts[2])
    ) {
      return false;
    }

    const [, encodedPayload, encodedSignature] = parts;
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    if (suppliedSignature.length !== SIGNATURE_BYTES) return false;

    const expectedSignature = signEncodedPayload(encodedPayload, secret);
    if (!timingSafeEqual(suppliedSignature, expectedSignature)) return false;

    const payload = parseSignedPayload(encodedPayload);
    if (!payload || !payloadMatchesState(payload, expectedState)) return false;

    if (
      payload.issuedAtMs < 0 ||
      payload.expiresAtMs - payload.issuedAtMs !== ADMIN_CATALOG_CONFIRMATION_LIMITS.ttlMs ||
      nowMs < payload.issuedAtMs ||
      nowMs > payload.expiresAtMs
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
const TRUSTED_IMAGE_HOSTNAME = "content.pancake.vn";
const MAX_IMAGE_URL_LENGTH = 4096;

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg"]);

export type TrustedProductImage = {
  url: string;
  alt: string;
};

export type StorefrontProductMedia = {
  primary: TrustedProductImage | null;
  gallery: readonly TrustedProductImage[];
};

/**
 * Validates and normalizes a candidate product image URL against the
 * strict reviewed HTTPS Pancake CDN media trust contract.
 *
 * Rules:
 * - Scheme must be strictly HTTPS
 * - Host must exactly match `content.pancake.vn` (no wildcards or IP addresses)
 * - Port must be default HTTPS port (no custom ports)
 * - Authority must not contain user credentials
 * - Path must not contain path traversal (`..`)
 * - Path must match exact reviewed P0 shape `/:segment/:id/:id/:id/:file.jpg`
 * - Length must be bounded (<= 4096 chars)
 */
export function parseTrustedProductImageUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IMAGE_URL_LENGTH) {
    return null;
  }

  // Reject path traversal in raw input before WHATWG URL normalization
  if (
    trimmed.includes("/..") ||
    trimmed.includes("../") ||
    trimmed.toLowerCase().includes("%2e%2e")
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== TRUSTED_IMAGE_HOSTNAME) {
    return null;
  }

  // Reject custom ports, explicit default ports, or credentials in authority
  const authority = trimmed.slice(8).split("/")[0] ?? "";
  if (
    authority !== TRUSTED_IMAGE_HOSTNAME ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return null;
  }

  // Enforce reviewed Pancake CDN path shape: /:segment/:id/:id/:id/:file.jpg
  const pathname = parsed.pathname;
  if (!isValidReviewedMediaPath(pathname)) {
    return null;
  }

  return parsed.toString();
}

const PANCAKE_MEDIA_PATH_REGEX =
  /^\/[a-zA-Z0-9_-]+\/\d+\/\d+\/\d+\/[a-zA-Z0-9_.-]+\.jpg$/;

function isValidReviewedMediaPath(pathname: string): boolean {
  if (!PANCAKE_MEDIA_PATH_REGEX.test(pathname) || pathname.includes("..")) {
    return false;
  }

  const parts = pathname.split("/");
  // Expected structure: ["", segment, id1, id2, id3, filename]
  if (parts.length !== 6) {
    return false;
  }

  const filename = parts[5]!;
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return false;
  }

  const extension = filename.slice(lastDotIndex);
  return ALLOWED_IMAGE_EXTENSIONS.has(extension);
}

export const MAX_MEDIA_CANDIDATES_SCANNED = 100;
export const MAX_STOREFRONT_GALLERY_IMAGES = 12;

/**
 * Resolves trusted primary photography and gallery media from product-level
 * and variant-level image URLs deterministically with deduplication.
 *
 * Constraints & Bounds:
 * - Scans at most MAX_MEDIA_CANDIDATES_SCANNED (100) raw candidate image URLs
 *   to bound CPU/memory consumption against untrusted external payloads.
 * - Caps returned gallery items at MAX_STOREFRONT_GALLERY_IMAGES (12) unique
 *   trusted images to optimize DOM footprint and downstream rendering.
 *
 * Order of priority:
 * 1. Product primaryImageUrl (if valid and trusted)
 * 2. Variant 0 image URLs (in order)
 * 3. Variant 1 image URLs (in order)
 * ...
 */
export function resolveStorefrontProductMedia({
  productName,
  primaryImageUrl,
  variantImageUrls,
}: {
  productName: string;
  primaryImageUrl?: string | null;
  variantImageUrls?: readonly (readonly (string | null | undefined)[])[];
}): StorefrontProductMedia {
  const cleanProductName = productName.trim() || "Product";
  const uniqueUrls: string[] = [];
  const seenUrls = new Set<string>();
  let scannedCount = 0;

  function tryAdd(candidate: unknown) {
    if (
      scannedCount >= MAX_MEDIA_CANDIDATES_SCANNED ||
      uniqueUrls.length >= MAX_STOREFRONT_GALLERY_IMAGES
    ) {
      return;
    }

    scannedCount++;
    const trusted = parseTrustedProductImageUrl(candidate);
    if (trusted !== null && !seenUrls.has(trusted)) {
      seenUrls.add(trusted);
      uniqueUrls.push(trusted);
    }
  }

  if (primaryImageUrl) {
    tryAdd(primaryImageUrl);
  }

  if (variantImageUrls) {
    for (const list of variantImageUrls) {
      if (
        uniqueUrls.length >= MAX_STOREFRONT_GALLERY_IMAGES ||
        scannedCount >= MAX_MEDIA_CANDIDATES_SCANNED
      ) {
        break;
      }

      if (Array.isArray(list)) {
        for (const item of list) {
          if (
            uniqueUrls.length >= MAX_STOREFRONT_GALLERY_IMAGES ||
            scannedCount >= MAX_MEDIA_CANDIDATES_SCANNED
          ) {
            break;
          }
          tryAdd(item);
        }
      }
    }
  }

  if (uniqueUrls.length === 0) {
    return {
      primary: null,
      gallery: [],
    };
  }

  const isSingle = uniqueUrls.length === 1;
  const gallery: TrustedProductImage[] = uniqueUrls.map((url, index) => ({
    url,
    alt: isSingle ? cleanProductName : `${cleanProductName} - Ảnh ${index + 1}`,
  }));

  const primary: TrustedProductImage = {
    url: uniqueUrls[0]!,
    alt: cleanProductName,
  };

  return {
    primary,
    gallery,
  };
}

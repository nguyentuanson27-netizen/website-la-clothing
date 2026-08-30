import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GRAPH_API_VERSION,
  readMetaConversionsConfig,
  readMetaPixelConfig,
} from "../../src/integrations/meta/pixel-config.ts";

test("tracking stays off until a pixel id is configured", () => {
  assert.equal(readMetaPixelConfig({}), null);
  assert.equal(readMetaPixelConfig({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: "" }), null);
  assert.equal(readMetaConversionsConfig({}), null);
});

test("a configured pixel id must be a real Events Manager id", () => {
  assert.deepEqual(readMetaPixelConfig({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: "123456789012345" }), {
    pixelId: "123456789012345",
  });

  for (const value of ["12345", "not-a-pixel", "12345678901234567", "1234 5678"]) {
    assert.throws(() => readMetaPixelConfig({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: value }), RangeError);
  }
  // Whitespace is a paste accident, not an id: silently trimming it hides a broken deploy config.
  assert.throws(() => readMetaPixelConfig({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: " 123456789012345" }), RangeError);
});

test("the Conversions API needs both halves before it reports anything", () => {
  // A token without a pixel has nothing to report to, and a pixel without a token cannot report.
  assert.equal(readMetaConversionsConfig({ FACEBOOK_CAPI_ACCESS_TOKEN: "token" }), null);
  assert.equal(readMetaConversionsConfig({ NEXT_PUBLIC_FACEBOOK_PIXEL_ID: "123456789012345" }), null);

  assert.deepEqual(
    readMetaConversionsConfig({
      NEXT_PUBLIC_FACEBOOK_PIXEL_ID: "123456789012345",
      FACEBOOK_CAPI_ACCESS_TOKEN: "token",
    }),
    {
      pixelId: "123456789012345",
      accessToken: "token",
      graphApiVersion: DEFAULT_GRAPH_API_VERSION,
      testEventCode: null,
    },
  );
});

test("Graph API version and test event code are validated when overridden", () => {
  const base = {
    NEXT_PUBLIC_FACEBOOK_PIXEL_ID: "123456789012345",
    FACEBOOK_CAPI_ACCESS_TOKEN: "token",
  };

  assert.equal(
    readMetaConversionsConfig({ ...base, FACEBOOK_GRAPH_API_VERSION: "v23.0" })?.graphApiVersion,
    "v23.0",
  );
  assert.equal(
    readMetaConversionsConfig({ ...base, FACEBOOK_CAPI_TEST_EVENT_CODE: "TEST12345" })?.testEventCode,
    "TEST12345",
  );

  assert.throws(
    () => readMetaConversionsConfig({ ...base, FACEBOOK_GRAPH_API_VERSION: "21.0" }),
    RangeError,
  );
  assert.throws(
    () => readMetaConversionsConfig({ ...base, FACEBOOK_CAPI_TEST_EVENT_CODE: "12345" }),
    RangeError,
  );
});

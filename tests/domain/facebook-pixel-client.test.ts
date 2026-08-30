import assert from "node:assert/strict";
import test from "node:test";

const PIXEL_ID = "123456789012345";

function replaceGlobal(name: "window" | "document", value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, name);
      return;
    }
    Object.defineProperty(globalThis, name, previous);
  };
}

test("an already-finished no-op pixel script is treated as unavailable without waiting for a missed load event", async (t) => {
  const previousPixelId = process.env.LA_BUILD_FACEBOOK_PIXEL_ID;
  process.env.LA_BUILD_FACEBOOK_PIXEL_ID = PIXEL_ID;
  t.after(() => {
    if (previousPixelId === undefined) delete process.env.LA_BUILD_FACEBOOK_PIXEL_ID;
    else process.env.LA_BUILD_FACEBOOK_PIXEL_ID = previousPixelId;
  });

  const fbq = (..._args: unknown[]) => {};
  let listenerRegistrations = 0;
  const script = {
    dataset: { laMetaPixelStatus: "unavailable" },
    addEventListener() {
      listenerRegistrations += 1;
    },
  };

  const restoreWindow = replaceGlobal("window", { fbq });
  const restoreDocument = replaceGlobal("document", {
    querySelector() {
      return script;
    },
  });
  t.after(() => {
    restoreDocument();
    restoreWindow();
  });

  const { trackFacebookPixelEvent } = await import(
    "../../src/components/analytics/facebook-pixel-client.ts"
  );

  let accepted = 0;
  trackFacebookPixelEvent("Purchase", { currency: "VND", value: 449_000 }, "ORDER-1", () => {
    accepted += 1;
  });

  // The terminal state was recorded before this subscriber existed. Waiting for `load` now would
  // miss an event that has already happened and retain the acknowledgement callback forever.
  assert.equal(listenerRegistrations, 0);
  assert.equal(accepted, 0);
  assert.equal(typeof (fbq as { callMethod?: unknown }).callMethod, "undefined");
});

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

test("a loaded script that never initializes the pixel is not acknowledged as sent", async (t) => {
  const previousPixelId = process.env.LA_BUILD_FACEBOOK_PIXEL_ID;
  process.env.LA_BUILD_FACEBOOK_PIXEL_ID = PIXEL_ID;
  t.after(() => {
    if (previousPixelId === undefined) delete process.env.LA_BUILD_FACEBOOK_PIXEL_ID;
    else process.env.LA_BUILD_FACEBOOK_PIXEL_ID = previousPixelId;
  });

  let loadListener: EventListener | null = null;
  const fbq = (..._args: unknown[]) => {};
  const script = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type === "load") loadListener = listener as EventListener;
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

  assert.equal(accepted, 0);
  assert.notEqual(loadListener, null);

  // A proxy/ad blocker can return HTTP 200 with an empty/no-op body. The script element still
  // fires `load`, but Meta never installs `fbq.callMethod` and never drains the stub queue.
  loadListener!({} as Event);

  assert.equal(accepted, 0);
  assert.equal(typeof (fbq as { callMethod?: unknown }).callMethod, "undefined");
});

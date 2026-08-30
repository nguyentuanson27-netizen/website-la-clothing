/**
 * Browser-side pixel calls.
 *
 * Every caller has to tolerate `fbq` being absent: the pixel is unconfigured in some environments,
 * the script is loaded lazily, and ad blockers remove it outright. Analytics is never allowed to
 * throw into a shopper's path, so a missing pixel is a no-op rather than an error.
 */

type Fbq = ((
  method: "track" | "trackCustom",
  eventName: string,
  parameters?: Record<string, unknown>,
  options?: { eventID: string },
) => void) & { callMethod?: unknown };

export type FacebookPixelContent = Readonly<{
  id: string;
  quantity: number;
  item_price: number;
}>;

export type FacebookPixelEventParameters = Readonly<{
  content_ids?: readonly string[];
  content_name?: string;
  content_type?: "product";
  contents?: readonly FacebookPixelContent[];
  currency?: "VND";
  value?: number;
  num_items?: number;
}>;

/**
 * Whether this build ships a pixel at all.
 *
 * next.config.mjs declares this in `env`, so it is a literal here — the same one the pixel
 * component and the Content-Security-Policy are derived from. With no pixel configured the
 * storefront renders no snippet, `fbq` will never appear, and tracking must be a true no-op:
 * callers still fire events unconditionally, and queueing them would hold data and a timer for a
 * page's whole life in the default configuration.
 */
const PIXEL_CONFIGURED = (process.env.LA_BUILD_FACEBOOK_PIXEL_ID ?? "").length > 0;

/** `fbq` in any form: the inline snippet's queueing stub, or the loaded library. */
function readFbq(): Fbq | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as { fbq?: unknown }).fbq;
  return typeof candidate === "function" ? (candidate as Fbq) : null;
}

/**
 * True once `fbevents.js` is running rather than just the snippet's stub.
 *
 * The stub sets `loaded` itself, so that flag says nothing; the library is what defines
 * `callMethod` and what drains the stub's queue.
 */
function isPixelLibraryLoaded(): boolean {
  const fbq = readFbq();
  return fbq !== null && typeof fbq.callMethod === "function";
}

/**
 * Events are handed to `fbq` the moment it exists, stub included, so Meta's own pre-load queue does
 * the buffering it was built for — the library flushes it whenever it finishes loading, however
 * long that takes. Nothing here expires an event.
 *
 * Two things still need waiting on, and they are different:
 *
 *   - Before the snippet has run at all there is no `fbq` to hand anything to. Those calls are held
 *     here, in order, until there is. `next/script` loads the snippet `afterInteractive`, so a
 *     page-level event fired from a mount effect regularly lands in this window.
 *   - A caller that records an event as sent must not do so while it sits in a queue an ad blocker
 *     will discard. Those acknowledgements wait for the library itself, and they wait on its
 *     `load` event rather than a clock: a library that arrives late still sends the event, so
 *     abandoning its acknowledgement on a timer would leave a sale reported but never recorded,
 *     and every later visit would report it again.
 */
type PendingCall = {
  eventName: string;
  parameters: FacebookPixelEventParameters | undefined;
  eventId: string | undefined;
  onAccepted: (() => void) | undefined;
};

const POLL_INTERVAL_MS = 250;
/**
 * Bounds only the wait for `fbq` to be defined, which the snippet does synchronously as soon as it
 * runs. Reaching this means the snippet never executed at all; the calls stay queued and the next
 * `trackFacebookPixelEvent` re-checks, so stopping the timer costs nothing.
 */
const FBQ_APPEARANCE_WAIT_MS = 30_000;

/** Calls made before `fbq` existed at all, oldest first. */
let callsAwaitingFbq: PendingCall[] = [];
/** Acknowledgements for calls already handed over, waiting on the library to actually load. */
let acknowledgementsAwaitingLibrary: Array<() => void> = [];
let poll: ReturnType<typeof setInterval> | null = null;
let watchingLibraryScript = false;

function stopPolling(): void {
  if (poll !== null) {
    clearInterval(poll);
    poll = null;
  }
}

function flushAcknowledgements(): void {
  if (acknowledgementsAwaitingLibrary.length === 0) return;
  const acknowledgements = acknowledgementsAwaitingLibrary;
  acknowledgementsAwaitingLibrary = [];
  for (const acknowledge of acknowledgements) acknowledge();
}

function flushCallsAwaitingFbq(fbq: Fbq): void {
  if (callsAwaitingFbq.length === 0) return;
  const queued = callsAwaitingFbq;
  callsAwaitingFbq = [];
  for (const call of queued) {
    handToPixel(fbq, call.eventName, call.parameters, call.eventId, call.onAccepted);
  }
}

/**
 * Waits on the pixel script itself rather than on a clock.
 *
 * The snippet inserts the `fbevents.js` tag synchronously, so it is already in the document by the
 * time anything has been handed to the stub. `load` means the library ran and drained the queue;
 * `error` means it never will, and the acknowledgements are dropped so nothing is recorded as sent.
 * Either way this costs one listener rather than a running timer.
 */
function watchLibraryScript(): void {
  if (watchingLibraryScript) return;
  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="connect.facebook.net"]',
  );
  if (script === null) return;

  watchingLibraryScript = true;
  script.addEventListener("load", () => flushAcknowledgements(), { once: true });
  script.addEventListener(
    "error",
    () => {
      // Blocked or unreachable. Recording these as sent would suppress the retry that a later
      // visit would otherwise make.
      acknowledgementsAwaitingLibrary = [];
    },
    { once: true },
  );
}

function startPolling(): void {
  if (poll !== null) return;
  const stopWaitingAtMs = Date.now() + FBQ_APPEARANCE_WAIT_MS;
  poll = setInterval(() => {
    const fbq = readFbq();
    if (fbq !== null) {
      flushCallsAwaitingFbq(fbq);
      stopPolling();
      return;
    }
    if (Date.now() >= stopWaitingAtMs) stopPolling();
  }, POLL_INTERVAL_MS);
}

function handToPixel(
  fbq: Fbq,
  eventName: string,
  parameters: FacebookPixelEventParameters | undefined,
  eventId: string | undefined,
  onAccepted: (() => void) | undefined,
): void {
  try {
    if (eventId === undefined) {
      fbq("track", eventName, parameters as Record<string, unknown> | undefined);
    } else {
      fbq("track", eventName, parameters as Record<string, unknown> | undefined, {
        eventID: eventId,
      });
    }
  } catch {
    // A tracking failure is never worth interrupting a shopper for.
    return;
  }

  if (onAccepted === undefined) return;
  if (isPixelLibraryLoaded()) {
    onAccepted();
    return;
  }
  // Handed to the stub's queue. Acknowledge only once the library exists to drain it.
  acknowledgementsAwaitingLibrary.push(onAccepted);
  watchLibraryScript();
  // The script can finish between the check above and the listener being attached.
  if (isPixelLibraryLoaded()) flushAcknowledgements();
}

/**
 * Reports one event to the pixel.
 *
 * `eventId` must match the `event_id` of the Conversions API twin, which is how Meta collapses the
 * pair into one conversion instead of counting the purchase twice.
 *
 * `onAccepted` fires when the loaded pixel library has taken the event. That is an acknowledgement
 * of hand-off, not of receipt: it says the event is no longer at risk of being dropped on this
 * page, not that Meta's servers answered. It never fires while the pixel is blocked or absent,
 * which is what lets a caller safely record an event as sent.
 */
export function trackFacebookPixelEvent(
  eventName: string,
  parameters?: FacebookPixelEventParameters,
  eventId?: string,
  onAccepted?: () => void,
): void {
  // No pixel in this build: nothing will ever consume a queued event, so hold nothing.
  if (!PIXEL_CONFIGURED) return;
  if (typeof window === "undefined") return;

  const fbq = readFbq();
  if (fbq === null) {
    callsAwaitingFbq.push({ eventName, parameters, eventId, onAccepted });
    startPolling();
    return;
  }
  // Anything still queued from before the snippet ran goes first, so order is preserved.
  flushCallsAwaitingFbq(fbq);
  handToPixel(fbq, eventName, parameters, eventId, onAccepted);
}

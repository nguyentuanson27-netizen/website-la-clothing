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
 *     will discard. Those acknowledgements wait for the library itself.
 */
type PendingCall = {
  eventName: string;
  parameters: FacebookPixelEventParameters | undefined;
  eventId: string | undefined;
  onAccepted: (() => void) | undefined;
};

const POLL_INTERVAL_MS = 250;
/**
 * How long an acknowledgement waits for the library before it is abandoned.
 *
 * This is not an expiry on the event: that already sits in the pixel's own queue and goes out
 * whenever the library arrives. Abandoning an acknowledgement only means the caller does not record
 * the event as sent, so a later visit reports it again — Meta collapses the pair by event id. The
 * alternative, a blocked pixel leaving a timer running for the life of every page, is worse.
 */
const ACKNOWLEDGEMENT_WAIT_MS = 15_000;

/** Calls made before `fbq` existed at all, oldest first. */
let callsAwaitingFbq: PendingCall[] = [];
/** Acknowledgements for calls already handed over, waiting on the library to actually load. */
let acknowledgementsAwaitingLibrary: Array<{ acknowledge: () => void; expiresAtMs: number }> = [];
let poll: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (poll !== null) {
    clearInterval(poll);
    poll = null;
  }
}

function startPolling(): void {
  if (poll !== null) return;
  poll = setInterval(() => {
    const fbq = readFbq();
    if (fbq !== null && callsAwaitingFbq.length > 0) {
      const queued = callsAwaitingFbq;
      callsAwaitingFbq = [];
      for (const call of queued) {
        handToPixel(fbq, call.eventName, call.parameters, call.eventId, call.onAccepted);
      }
    }

    if (acknowledgementsAwaitingLibrary.length > 0) {
      if (isPixelLibraryLoaded()) {
        const acknowledgements = acknowledgementsAwaitingLibrary;
        acknowledgementsAwaitingLibrary = [];
        for (const { acknowledge } of acknowledgements) acknowledge();
      } else {
        // Blocked or never loading. Give up on the acknowledgements rather than poll forever.
        const now = Date.now();
        acknowledgementsAwaitingLibrary = acknowledgementsAwaitingLibrary.filter(
          (pending) => pending.expiresAtMs > now,
        );
      }
    }

    if (callsAwaitingFbq.length === 0 && acknowledgementsAwaitingLibrary.length === 0) {
      stopPolling();
    }
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
  acknowledgementsAwaitingLibrary.push({
    acknowledge: onAccepted,
    expiresAtMs: Date.now() + ACKNOWLEDGEMENT_WAIT_MS,
  });
  startPolling();
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
  handToPixel(fbq, eventName, parameters, eventId, onAccepted);
}

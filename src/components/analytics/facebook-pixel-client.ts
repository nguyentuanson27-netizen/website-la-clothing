/**
 * Browser-side pixel calls.
 *
 * Every caller has to tolerate `fbq` being absent: the pixel is unconfigured in some environments,
 * the script is loaded lazily, and ad blockers remove it outright. Analytics is never allowed to
 * throw into a shopper's path, so a missing pixel is a no-op rather than an error.
 */

type Fbq = (
  method: "track" | "trackCustom",
  eventName: string,
  parameters?: Record<string, unknown>,
  options?: { eventID: string },
) => void;

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

function readFbq(): Fbq | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as { fbq?: unknown }).fbq;
  return typeof candidate === "function" ? (candidate as Fbq) : null;
}

/**
 * The base snippet loads with `afterInteractive`, so `fbq` can still be undefined when a page's
 * mount effect reports its event — a race that page-level events lose most often, because they
 * fire the instant the page appears. Dropping those would quietly cost exactly the events worth
 * having: Purchase and InitiateCheckout.
 *
 * Calls made before the snippet runs are held here and replayed in order once it does. Meta's own
 * snippet queues everything after that point, so this only has to cover the gap before it exists.
 */
type PendingCall = {
  eventName: string;
  parameters: FacebookPixelEventParameters | undefined;
  eventId: string | undefined;
  onDelivered: (() => void) | undefined;
};

const PENDING_POLL_MS = 120;
const PENDING_GIVE_UP_MS = 10_000;

let pendingCalls: PendingCall[] = [];
let pendingPoll: ReturnType<typeof setInterval> | null = null;
let pendingWaitedMs = 0;

function stopPendingPoll(): void {
  if (pendingPoll !== null) {
    clearInterval(pendingPoll);
    pendingPoll = null;
  }
}

function flushPendingCalls(fbq: Fbq): void {
  const queued = pendingCalls;
  pendingCalls = [];
  stopPendingPoll();
  for (const call of queued) {
    dispatch(fbq, call.eventName, call.parameters, call.eventId, call.onDelivered);
  }
}

function enqueuePendingCall(call: PendingCall): void {
  pendingCalls.push(call);
  if (pendingPoll !== null) return;

  pendingWaitedMs = 0;
  pendingPoll = setInterval(() => {
    const fbq = readFbq();
    if (fbq !== null) {
      flushPendingCalls(fbq);
      return;
    }
    pendingWaitedMs += PENDING_POLL_MS;
    if (pendingWaitedMs >= PENDING_GIVE_UP_MS) {
      // The pixel is blocked or absent. Stop holding events that will never be delivered.
      pendingCalls = [];
      stopPendingPoll();
    }
  }, PENDING_POLL_MS);
}

function dispatch(
  fbq: Fbq,
  eventName: string,
  parameters: FacebookPixelEventParameters | undefined,
  eventId: string | undefined,
  onDelivered: (() => void) | undefined,
): void {
  try {
    if (eventId === undefined) {
      fbq("track", eventName, parameters as Record<string, unknown> | undefined);
    } else {
      fbq("track", eventName, parameters as Record<string, unknown> | undefined, {
        eventID: eventId,
      });
    }
    // Only now has the event actually reached the pixel. Callers that record an event as sent
    // rely on this, so a queued call that was never flushed must not look delivered.
    onDelivered?.();
  } catch {
    // A tracking failure is never worth interrupting a shopper for.
  }
}

/**
 * `eventId` must match the `event_id` of the Conversions API twin, which is how Meta collapses the
 * pair into one conversion instead of counting the purchase twice.
 */
export function trackFacebookPixelEvent(
  eventName: string,
  parameters?: FacebookPixelEventParameters,
  eventId?: string,
  onDelivered?: () => void,
): void {
  if (typeof window === "undefined") return;

  const fbq = readFbq();
  if (fbq === null) {
    enqueuePendingCall({ eventName, parameters, eventId, onDelivered });
    return;
  }
  dispatch(fbq, eventName, parameters, eventId, onDelivered);
}

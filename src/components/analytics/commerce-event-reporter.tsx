import type { TrackingEvent } from "@/tracking/commerce-events";
import { readTrackingConfig, resolveTrackingRuntime } from "@/tracking/config";

import { CommerceEventPublisher } from "./commerce-event-publisher";

/**
 * The server-side gate for a page-level commerce event.
 *
 * A deployment with tracking disabled renders no bootstrap, so nothing has established the shared
 * dataLayer. Checking here rather than in the browser means such a deployment never even ships the
 * event payload, instead of shipping it and having a client component decide to create a dataLayer
 * nobody asked for.
 *
 * `event` is `null` whenever the page could not build a canonical event — an unsafe cart, a product
 * with no usable identity. That is the fail-closed path and it renders nothing at all.
 */
export function CommerceEventReporter({ event }: { event: TrackingEvent | null }) {
  if (event === null) return null;

  const runtime = resolveTrackingRuntime(readTrackingConfig());
  if (!runtime.publishesDataLayer) return null;

  return <CommerceEventPublisher event={event} />;
}

/** Whether this deployment publishes commerce events at all, for surfaces that emit on interaction. */
export function isCommerceTrackingEnabled(): boolean {
  return resolveTrackingRuntime(readTrackingConfig()).publishesDataLayer;
}

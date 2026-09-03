"use client";

import { useEffect, useRef } from "react";

import type { TrackingEvent } from "@/tracking/commerce-events";
import { publishBrowserTrackingEvent } from "@/tracking/data-layer";

/**
 * Publishes one canonical commerce event when it appears, and once only.
 *
 * A React component can mount twice for reasons that have nothing to do with the shopper —
 * StrictMode's development double-invoke, a Suspense replay, a parent re-keying — and each of those
 * would otherwise report a second `view_item` or `view_cart` for one visit. The event's own
 * serialization is the identity: the same basket, list or product reported again is a duplicate, a
 * changed one is a genuinely new observation and is published.
 *
 * Nothing here can interrupt a shopper. The publisher already swallows a blocked, hostile or absent
 * dataLayer, and the effect body is guarded as well so a serialization failure is a no-op too.
 */
export function CommerceEventPublisher({ event }: { event: TrackingEvent }) {
  const lastPublished = useRef<string | null>(null);

  useEffect(() => {
    let signature: string;
    try {
      signature = JSON.stringify(event);
    } catch {
      return;
    }
    if (lastPublished.current === signature) return;
    lastPublished.current = signature;

    try {
      publishBrowserTrackingEvent(event);
    } catch {
      // Tracking never interrupts a shopper.
    }
  }, [event]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";

import {
  trackFacebookPixelEvent,
  type FacebookPixelEventParameters,
} from "./facebook-pixel-client";

type FacebookPixelEventProps = {
  name: string;
  parameters?: FacebookPixelEventParameters;
  /** Set where a Conversions API twin exists, so Meta counts the pair as one conversion. */
  eventId?: string;
};

/**
 * Reports one page-level event when the page it sits on mounts.
 *
 * Deliberately fires once per mount rather than tracking its props: `parameters` is a fresh object
 * on every render, so a dependency on it would report the same checkout over and over.
 */
export function FacebookPixelEvent({ name, parameters, eventId }: FacebookPixelEventProps) {
  const hasReported = useRef(false);

  useEffect(() => {
    if (hasReported.current) return;
    hasReported.current = true;
    trackFacebookPixelEvent(name, parameters, eventId);
  }, [eventId, name, parameters]);

  return null;
}

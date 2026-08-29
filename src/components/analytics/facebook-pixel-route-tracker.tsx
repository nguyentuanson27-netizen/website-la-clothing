"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackFacebookPixelEvent } from "./facebook-pixel-client";

/**
 * Reports PageView for client-side navigations.
 *
 * The base snippet already fired PageView for the document that loaded it, so the first run here
 * is skipped; without that guard every first page would be counted twice.
 */
export function FacebookPixelRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isInitialRender = useRef(true);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    trackFacebookPixelEvent("PageView");
  }, [pathname, searchParams]);

  return null;
}

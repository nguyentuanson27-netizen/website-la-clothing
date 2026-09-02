"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-asks the server for Flash state after a server-computed delay.
 *
 * Two things are deliberately absent. There is no absolute deadline, so nothing here compares a
 * time against the device clock — a wrong or tampered clock cannot make a sale look started or
 * finished. And there is no assumption that timers run: a backgrounded tab may have its timers
 * throttled or frozen entirely, so a page that slept through a boundary would otherwise wake
 * showing prices that ended hours ago. Becoming visible again, or being restored from the
 * back/forward cache, therefore revalidates immediately rather than waiting for a timer that may
 * never have fired.
 */
export function FlashSaleRefresher({ refreshAfterMs }: { refreshAfterMs: number }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const revalidate = () => {
      if (cancelled) return;
      // Server-side revalidation: the server re-resolves membership against its own clock.
      router.refresh();
    };

    const timer = setTimeout(revalidate, Math.max(0, refreshAfterMs));

    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    // `pageshow` with `persisted` covers back/forward-cache restores, where the page is resumed
    // whole and no effect would otherwise re-run.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refreshAfterMs, router]);

  return null;
}

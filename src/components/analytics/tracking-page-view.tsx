import { Suspense } from "react";

import { readTrackingConfig, resolveTrackingRuntime } from "@/tracking/config";

import { TrackingPageViewReporter } from "./tracking-page-view-reporter";

/**
 * The single canonical page-view authority.
 *
 * Owning `page_view` in application code is what makes it safe to disable GTM/GA4's own automatic
 * and history-based page views later: one navigation stays one event instead of being counted twice
 * once a container is finally loaded.
 */
export function TrackingPageView() {
  const runtime = resolveTrackingRuntime(readTrackingConfig());
  if (!runtime.publishesDataLayer) return null;

  return (
    <Suspense fallback={null}>
      <TrackingPageViewReporter />
    </Suspense>
  );
}

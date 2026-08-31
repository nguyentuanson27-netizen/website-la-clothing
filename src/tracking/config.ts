/**
 * Desired tracking configuration and the fail-closed GTM interlock.
 *
 * The application owns which measurement mode a deployment *wants*. Whether Google Tag Manager is
 * actually loaded is a separate, stricter question: no GTM container may be loaded until an exact
 * saved container version has been exported and reviewed (marketing spec §5.1). Until that unit
 * lands, `disabled`, `preview` and `live` all resolve to the same operational outcome — no GTM
 * script, no vendor network delivery — while still letting a deployment express and test its
 * intended mode.
 *
 * The mode is deliberately a server-only variable. A `NEXT_PUBLIC_` value, the `Host` header or any
 * other request-controlled input must never be able to promote a deployment to `live`.
 */

type TrackingEnvironment = Readonly<Record<string, string | undefined>>;

export const TRACKING_MODES = ["disabled", "preview", "live"] as const;

export type TrackingMode = (typeof TRACKING_MODES)[number];

export type TrackingConfig = Readonly<{
  desiredMode: TrackingMode;
  containerId: string | null;
}>;

export type TrackingRuntime = Readonly<{
  mode: TrackingMode;
  containerId: string | null;
  /** Whether the browser bootstrap (dataLayer, mode, consent defaults, page views) is rendered. */
  publishesDataLayer: boolean;
  /** Always false until the reviewed immutable GTM version exists. */
  loadsGoogleTagManager: false;
}>;

const GTM_CONTAINER_ID = /^GTM-[A-Z0-9]{4,10}$/;

/**
 * The reviewed-GTM-version gate. Flipping this is not a configuration change: it belongs to the
 * unit that exports, checksums and reviews an exact saved container version, opens the CSP and adds
 * the loader. Nothing in this module may make GTM load.
 */
const REVIEWED_GTM_VERSION_AVAILABLE = false;

function isTrackingMode(value: string): value is TrackingMode {
  return (TRACKING_MODES as readonly string[]).includes(value);
}

export function readTrackingConfig(env: TrackingEnvironment = process.env): TrackingConfig {
  const rawMode = env.LA_TRACKING_MODE;
  // Absent is the fail-closed default; a present-but-unrecognised value is a deployment mistake and
  // must not silently degrade to "disabled" in a deployment that believes it is measuring.
  const desiredMode = rawMode === undefined ? "disabled" : rawMode;
  if (!isTrackingMode(desiredMode)) {
    throw new RangeError(`LA_TRACKING_MODE must be one of ${TRACKING_MODES.join(", ")}`);
  }

  const rawContainerId = env.LA_GTM_CONTAINER_ID;
  if (desiredMode === "disabled") {
    if (rawContainerId !== undefined && rawContainerId.length > 0) {
      throw new RangeError(
        "LA_GTM_CONTAINER_ID must not be configured while LA_TRACKING_MODE is disabled",
      );
    }
    return Object.freeze({ desiredMode, containerId: null });
  }

  if (rawContainerId === undefined || !GTM_CONTAINER_ID.test(rawContainerId)) {
    throw new RangeError(
      "LA_GTM_CONTAINER_ID must be the GTM-XXXXXXX container id from Tag Manager",
    );
  }

  return Object.freeze({ desiredMode, containerId: rawContainerId });
}

export function resolveTrackingRuntime(config: TrackingConfig): TrackingRuntime {
  return Object.freeze({
    mode: config.desiredMode,
    containerId: config.containerId,
    publishesDataLayer: config.desiredMode !== "disabled",
    loadsGoogleTagManager: false as const,
  });
}

/**
 * The single place any future loader must ask before rendering a GTM script. It is false for every
 * mode while the reviewed immutable version gate is closed.
 */
export function shouldLoadGoogleTagManager(runtime: TrackingRuntime): boolean {
  return REVIEWED_GTM_VERSION_AVAILABLE && runtime.mode !== "disabled";
}

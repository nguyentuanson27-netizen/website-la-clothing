/**
 * The first-party bootstrap script text.
 *
 * Kept separate from the component so the exact bytes that reach the browser can be asserted
 * directly: that it establishes the dataLayer, pins the tracking mode, queues the consent defaults,
 * and contacts no vendor origin.
 */

import {
  buildConsentDefaultCommand,
  type ConsentPolicy,
} from "./consent.ts";
import { DATA_LAYER_NAME } from "./data-layer.ts";
import type { TrackingRuntime } from "./config.ts";

/**
 * `mode` comes from a fixed enum and the consent command from a closed key set, so neither can
 * carry attacker text. Escaping `<` keeps any future value from being able to close the script
 * element that carries this.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildTrackingBootstrapScript(
  runtime: TrackingRuntime,
  policy: ConsentPolicy,
): string {
  const mode = serialize(runtime.mode);
  const [command, stage, state] = buildConsentDefaultCommand(policy);

  return [
    `window.${DATA_LAYER_NAME} = window.${DATA_LAYER_NAME} || [];`,
    // Pinned so nothing on the page can promote a deployment to a mode the server did not choose.
    // A pre-existing definition means something already claimed the global; leave it and carry on
    // rather than throwing inside a page that is otherwise fine.
    `try { Object.defineProperty(window, 'la_tracking_mode', { value: ${mode}, writable: false, configurable: false }); } catch (error) {}`,
    `window.${DATA_LAYER_NAME}.push({ la_tracking_mode: ${mode} });`,
    // Consent defaults are queued through Google's documented `gtag` wrapper, ahead of anything
    // that could ever measure.
    //
    // The wrapper is not decoration: `gtag(...)` pushes its `arguments` object, and that array-like
    // shape — not a plain array — is what a container recognises as a consent command. Emitting
    // `["consent","default",{...}]` directly would look equivalent and be ignored. Defined
    // defensively so an existing `gtag` (a later loader's, say) is never replaced.
    `window.gtag = window.gtag || function () { window.${DATA_LAYER_NAME}.push(arguments); };`,
    `window.gtag(${serialize(command)}, ${serialize(stage)}, ${serialize(state)});`,
  ].join("\n");
}

import { Suspense } from "react";
import Script from "next/script";

import { readMetaPixelConfig } from "@/integrations/meta/pixel-config";

import { FacebookPixelRouteTracker } from "./facebook-pixel-route-tracker";

/**
 * Meta's standard base snippet. Rendered only when a pixel id is configured, so an unconfigured
 * environment ships no third-party script and the CSP stays closed around it.
 *
 * The snippet's own `fbq('track', 'PageView')` only fires on a full document load. App Router
 * navigations never reload it, so FacebookPixelRouteTracker reports the ones that follow.
 */
export function FacebookPixel() {
  const config = readMetaPixelConfig();
  if (config === null) return null;

  return (
    <>
      <Script id="facebook-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(config.pixelId)});
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- a tracking beacon, not content:
            it must reach Meta's origin unrewritten, and next/image cannot render inside noscript. */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${encodeURIComponent(config.pixelId)}&ev=PageView&noscript=1`}
        />
      </noscript>
      {/* The tracker reads search params, which opts its subtree out of static rendering; the
          boundary keeps that confined to a component that renders nothing. */}
      <Suspense fallback={null}>
        <FacebookPixelRouteTracker />
      </Suspense>
    </>
  );
}

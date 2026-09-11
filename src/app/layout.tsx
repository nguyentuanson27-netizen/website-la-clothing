import type { Metadata } from "next";
import { connection } from "next/server";
import { Playfair_Display } from "next/font/google";

import { FacebookPixel } from "@/components/analytics/facebook-pixel";
import { TrackingBootstrap } from "@/components/analytics/tracking-bootstrap";
import { TrackingPageView } from "@/components/analytics/tracking-page-view";
import { ShippingPromotionBar } from "@/components/commerce/shipping-promotion-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buildRootMetadata } from "@/seo/root-metadata";
import { readSearchExposure } from "@/seo/search-exposure";
import { buildSiteStructuredData, serializeJsonLd } from "@/seo/structured-data";

import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin", "vietnamese"],
  variable: "--font-serif",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const exposure = readSearchExposure();

  return buildRootMetadata(exposure);
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const exposure = readSearchExposure();
  const siteStructuredData = buildSiteStructuredData({ origin: exposure.origin });

  return (
    <html lang="vi" className={playfair.variable}>
      <body className={playfair.variable}>
        <TrackingBootstrap />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteStructuredData) }}
        />
        {/* Pinned together: the promotion and the nav stay on screen as one block while the
            page scrolls under them. Sticky rather than fixed, so they still occupy layout
            space and nothing has to be offset to sit below them. */}
        <div className="site-masthead">
          <ShippingPromotionBar />
          <SiteHeader />
        </div>
        <main id="main-content">{children}</main>
        <SiteFooter />
        <TrackingPageView />
        <FacebookPixel />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";

import { FacebookPixel } from "@/components/analytics/facebook-pixel";
import { ShippingPromotionBar } from "@/components/commerce/shipping-promotion-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { readSearchExposure } from "@/seo/search-exposure";
import { buildSiteStructuredData, serializeJsonLd } from "@/seo/structured-data";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const exposure = readSearchExposure();

  return {
    title: {
      default: "LA Clothing — Modern Menswear",
      template: "%s — LA Clothing",
    },
    description: "Minimal, modern menswear by LA Clothing.",
    metadataBase: new URL(exposure.origin),
    robots: exposure.indexingEnabled
      ? undefined
      : {
          index: false,
          follow: false,
        },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const exposure = readSearchExposure();
  const siteStructuredData = buildSiteStructuredData({ origin: exposure.origin });

  return (
    <html lang="vi">
      <body>
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
        <FacebookPixel />
      </body>
    </html>
  );
}

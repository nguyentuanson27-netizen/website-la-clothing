import type { Metadata } from "next";
import { connection } from "next/server";

import { ShippingPromotionBar } from "@/components/commerce/shipping-promotion-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { readSearchExposure } from "@/seo/search-exposure";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <ShippingPromotionBar />
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

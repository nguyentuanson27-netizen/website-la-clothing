"use client";

import Image from "next/image";
import { useState } from "react";

import type { StorefrontProductMedia } from "@/commerce/product-media";

type ProductGalleryProps = {
  media: StorefrontProductMedia;
  productName: string;
};

export function ProductGallery({ media, productName }: ProductGalleryProps) {
  const images = media.gallery;
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fallback state when no trusted photography is present
  if (images.length === 0) {
    return (
      <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
        <div
          className="product-visual product-visual--stone relative aspect-[3/4] overflow-hidden md:min-h-[44rem]"
          aria-hidden="true"
        >
          <span className="garment-silhouette" />
        </div>
        <p className="mt-3 text-xs uppercase tracking-[0.12em] text-black/60">
          Hình ảnh sản phẩm đang được chuẩn hóa cho storefront.
        </p>
      </div>
    );
  }

  // Single-image presentation (no redundant carousel / thumbnail controls)
  if (images.length === 1) {
    const singleImage = images[0]!;
    return (
      <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
        <div className="product-visual product-visual--stone relative aspect-[3/4] overflow-hidden md:min-h-[44rem]">
          <Image
            src={singleImage.url}
            alt={singleImage.alt || productName}
            fill
            preload
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    );
  }

  // Multi-image gallery with interactive accessible thumbnails
  const activeImage = images[selectedIndex] ?? images[0]!;

  return (
    <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
      <div
        className="product-visual product-visual--stone relative aspect-[3/4] overflow-hidden md:min-h-[44rem]"
        role="region"
        aria-roledescription="carousel"
        aria-label={`Bộ sưu tập hình ảnh ${productName}`}
      >
        <Image
          key={activeImage.url}
          src={activeImage.url}
          alt={activeImage.alt || `${productName} - Ảnh ${selectedIndex + 1}`}
          fill
          preload={selectedIndex === 0}
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover transition-opacity duration-300"
        />
      </div>

      <nav
        className="mt-4 flex flex-wrap gap-3"
        aria-label={`Danh sách ảnh chi tiết của ${productName}`}
      >
        {images.map((img, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={img.url}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`Xem ảnh ${index + 1} của ${productName}`}
              aria-pressed={isSelected}
              className={`relative h-20 w-16 overflow-hidden border transition-all ${
                isSelected
                  ? "border-black ring-1 ring-black"
                  : "border-black/20 opacity-70 hover:opacity-100"
              } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black`}
            >
              <Image
                src={img.url}
                alt={img.alt || `Thumbnail ${index + 1}`}
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

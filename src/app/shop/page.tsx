import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shop | LA Clothing",
  description: "Explore LA Clothing menswear.",
};

export default function ShopPage() {
  return (
    <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">LA Clothing / Store</p>
      <h1 className="mt-4 max-w-5xl text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        SHOP
      </h1>
      <div className="mt-12 grid gap-8 border-t border-black/20 pt-8 md:grid-cols-2">
        <p className="max-w-xl font-serif text-2xl leading-snug md:text-3xl">
          Relaxed proportions, clean construction and an everyday neutral palette.
        </p>
        <p className="max-w-lg text-sm leading-6 text-black/70 md:justify-self-end">
          The live catalog will populate from the store inventory source as the commerce integration is completed.
        </p>
      </div>
    </main>
  );
}

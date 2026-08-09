import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bag",
  description: "Your LA Clothing shopping bag.",
};

export default function CartPage() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Shopping / Bag</p>
      <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        YOUR BAG
      </h1>
      <div className="mt-12 border-t border-black/20 pt-8">
        <p className="font-serif text-2xl md:text-3xl">Your bag is empty.</p>
        <Link className="text-link mt-6 inline-block" href="/shop">
          Continue shopping ↗
        </Link>
      </div>
    </div>
  );
}

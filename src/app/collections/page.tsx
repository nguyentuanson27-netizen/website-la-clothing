import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collections | LA Clothing",
  description: "Seasonal collections from LA Clothing.",
};

export default function CollectionsPage() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Archive / Collections</p>
      <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        COLLECTIONS
      </h1>
      <div className="mt-12 grid gap-px border border-black/20 bg-black/20 md:grid-cols-2">
        <article className="min-h-72 bg-[var(--paper)] p-8 md:p-12">
          <p className="eyebrow">Fall / Winter 2026</p>
          <h2 className="mt-6 max-w-md font-serif text-4xl leading-none md:text-6xl">QUIET FORM</h2>
        </article>
        <article className="min-h-72 bg-[var(--paper)] p-8 md:p-12">
          <p className="eyebrow">Core / Permanent</p>
          <h2 className="mt-6 max-w-md font-serif text-4xl leading-none md:text-6xl">EVERYDAY UNIFORM</h2>
        </article>
      </div>
    </div>
  );
}

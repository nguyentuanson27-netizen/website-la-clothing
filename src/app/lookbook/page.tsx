import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Lookbook",
  description: "LA Clothing seasonal editorial and styling stories.",
};

export default function LookbookPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-16 md:py-24">
      <header className="border-b border-black/20 pb-12 md:pb-16">
        <p className="eyebrow">Editorial / 02 · Fall / Winter 2026</p>
        <h1 className="mt-4 max-w-6xl text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
          CITY UNIFORM
        </h1>
        <div className="mt-10 grid gap-8 md:grid-cols-2 md:items-end">
          <p className="max-w-xl font-serif text-2xl leading-snug md:text-4xl">
            A study in quiet utility.
          </p>
          <p className="max-w-lg text-sm leading-6 text-black/65 md:justify-self-end">
            Soft tailoring, practical layers and measured proportions for moving through the city without changing
            character between morning and night.
          </p>
        </div>
      </header>

      <section className="grid border-b border-black/20 md:grid-cols-[1.35fr_0.65fr]" aria-labelledby="morning-transit-title">
        <div className="lookbook-panel min-h-[62vh] md:min-h-[760px]" aria-hidden="true">
          <span className="lookbook-figure" />
        </div>
        <div className="flex flex-col justify-end py-12 md:px-10 md:py-16">
          <p className="eyebrow">Chapter / 01 · 07:40</p>
          <h2 id="morning-transit-title" className="mt-4 font-serif text-[clamp(2.8rem,6vw,6rem)] leading-[0.9] tracking-[-0.045em]">
            MORNING / TRANSIT
          </h2>
          <p className="mt-6 max-w-md font-serif text-xl leading-relaxed text-black/75 md:text-2xl">
            A relaxed jacket over a clean base layer. Enough structure for the first meeting, enough room for the
            train across town.
          </p>
        </div>
      </section>

      <section className="grid border-b border-black/20 md:grid-cols-[0.65fr_1.35fr]" aria-labelledby="late-return-title">
        <div className="flex flex-col justify-end py-12 md:px-10 md:py-16">
          <p className="eyebrow">Chapter / 02 · 21:15</p>
          <h2 id="late-return-title" className="mt-4 font-serif text-[clamp(2.8rem,6vw,6rem)] leading-[0.9] tracking-[-0.045em]">
            LATE / RETURN
          </h2>
          <p className="mt-6 max-w-md font-serif text-xl leading-relaxed text-black/75 md:text-2xl">
            The same uniform after dark: softer at the edges, still deliberate. Layers come off; proportion does the
            rest.
          </p>
        </div>
        <div className="lookbook-panel min-h-[62vh] bg-[var(--olive)] md:min-h-[760px]" aria-hidden="true">
          <span className="lookbook-figure lookbook-figure--small" />
        </div>
      </section>

      <section className="grid gap-8 py-16 md:grid-cols-[1fr_auto] md:items-end md:py-24" aria-labelledby="lookbook-close-title">
        <div>
          <p className="eyebrow">Field notes</p>
          <h2 id="lookbook-close-title" className="mt-4 max-w-4xl font-serif text-[clamp(2.5rem,5vw,5.5rem)] leading-[0.92] tracking-[-0.04em]">
            Built for repetition, not a single occasion.
          </h2>
        </div>
        <Link className="text-link md:mb-2" href="/shop">
          Shop the current edit ↗
        </Link>
      </section>
    </div>
  );
}

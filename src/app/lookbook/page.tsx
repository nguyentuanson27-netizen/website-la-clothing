import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lookbook",
  description: "LA Clothing seasonal editorial and styling stories.",
};

export default function LookbookPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Editorial / 02</p>
      <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        CITY UNIFORM
      </h1>
      <div className="mt-12 grid min-h-[60vh] gap-px bg-black/20 md:grid-cols-[1.4fr_0.6fr]">
        <div className="bg-[var(--stone)]" aria-hidden="true" />
        <div className="flex flex-col justify-end bg-[var(--olive)] p-8 text-[var(--white)] md:p-12">
          <p className="eyebrow">Fall / Winter 2026</p>
          <p className="mt-6 max-w-md font-serif text-3xl leading-tight md:text-5xl">
            Soft tailoring and utility layers for the pace of the city.
          </p>
        </div>
      </div>
    </div>
  );
}

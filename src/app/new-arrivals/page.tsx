import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Arrivals | LA Clothing",
  description: "Latest menswear arrivals from LA Clothing.",
};

export default function NewArrivalsPage() {
  return (
    <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Drop / 01</p>
      <h1 className="mt-4 max-w-6xl text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        NEW ARRIVALS
      </h1>
      <div className="mt-12 border-t border-black/20 pt-8">
        <p className="max-w-2xl font-serif text-2xl leading-snug md:text-3xl">
          The newest silhouettes, fabrics and seasonal layers — released in considered quantities.
        </p>
      </div>
    </main>
  );
}

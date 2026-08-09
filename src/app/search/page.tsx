import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search",
  description: "Search LA Clothing products and collections.",
};

export default function SearchPage() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Find / Discover</p>
      <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        SEARCH
      </h1>
      <form className="mt-12 flex max-w-4xl border-b border-black" action="/search" method="get" role="search">
        <label className="sr-only" htmlFor="site-search">Search products</label>
        <input
          className="min-w-0 flex-1 bg-transparent py-4 text-xl outline-none placeholder:text-black/40 focus-visible:outline-2 focus-visible:outline-offset-4 md:text-3xl"
          id="site-search"
          name="q"
          placeholder="Shirts, trousers, outerwear…"
          type="search"
        />
        <button className="px-4 text-xs font-semibold uppercase tracking-[0.14em]" type="submit">
          Search
        </button>
      </form>
    </div>
  );
}
